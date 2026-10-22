import { spawn, execSync } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

// El contenedor de Docker es un proceso hijo de este script: si el script
// muere (o se lo mata con SIGTERM al cancelar), el contenedor sigue
// corriendo. Se lo nombra y se lo detiene explicitamente al cancelar.
let activeContainer = null;

function stopActiveContainer() {
  if (!activeContainer) return;
  const name = activeContainer;
  activeContainer = null;
  try {
    execSync(`docker stop -t 5 ${name}`, { stdio: "ignore", timeout: 20000 });
  } catch (error) {
    // Si el contenedor ya termino (--rm) o no existe, no hay nada que hacer.
  }
}

function onSignal(signal) {
  stopActiveContainer();
  process.exit(signal === "SIGINT" ? 130 : 143);
}

process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on("error", reject);
  });
}

function buildQuery(query, areaName, bounds) {
  const trimmedQuery = query?.trim() || "negocios";
  const trimmedArea = areaName?.trim();
  if (!bounds && trimmedArea) {
    return `${trimmedQuery} in ${trimmedArea}`;
  }
  return trimmedQuery;
}

function computeGeo(bounds, center, radiusKm) {
  if (center) {
    return {
      geo: `${center.lat.toFixed(6)},${center.lng.toFixed(6)}`,
      radiusMeters: Math.max(500, Math.round(Number(radiusKm || 0) * 1000)),
    };
  }
  if (!bounds) return null;
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  const latMeters = Math.abs(bounds.north - bounds.south) * 111_000;
  const avgLat = (bounds.north + bounds.south) / 2;
  const lonMeters =
    Math.abs(bounds.east - bounds.west) * 111_000 * Math.cos((avgLat * Math.PI) / 180);
  const radiusMeters = Math.max(latMeters, lonMeters) / 2;

  return {
    geo: `${centerLat.toFixed(6)},${centerLng.toFixed(6)}`,
    radiusMeters: Math.max(500, Math.round(radiusMeters)),
  };
}

/**
 * Zoom segun el tamano de celda de la grilla.
 * Google Maps devuelve mas resultados por celda cuanto mayor el zoom,
 * pero cada celda cubre menos superficie. Se busca que la celda y el
 * viewport se ajusten.
 */
function zoomForCell(cellKm) {
  if (cellKm <= 0.5) return 16;
  if (cellKm <= 1) return 15;
  if (cellKm <= 2) return 14;
  if (cellKm <= 5) return 13;
  return 12;
}

// Formato de proxy aceptado por el scraper:
//   http://user:pass@host:port | socks5://host:port | https://host:port
const PROXY_RE = /^(https?|socks5h?):\/\/([^\s@]+@)?[^\s:@]+:\d{1,5}$/;

/**
 * Valida la lista de proxies. Devuelve los validos y los rechazados
 * para poder avisarle al usuario en vez de ignorarlos en silencio.
 */
function parseProxies(raw) {
  const list = String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const valid = [];
  const invalid = [];
  for (const entry of list) {
    if (PROXY_RE.test(entry)) valid.push(entry);
    else invalid.push(entry);
  }
  return { valid, invalid };
}

/**
 * Oculta las credenciales de los proxies en el comando que se imprime
 * en los errores: no pueden filtrarse a logs ni a la UI.
 */
function redactArgs(args) {
  return args
    .map((arg, index) => {
      if (args[index - 1] === "-proxies" || args[index - 1] === "-proxies-file") {
        return String(arg)
          .split(",")
          .map(() => "***")
          .join(",");
      }
      return arg;
    })
    .join(" ");
}

async function runDockerScraper(payload) {
  const {
    query,
    queries,
    areaName,
    bounds,
    center,
    radiusKm,
    includeEmails,
    bbox,
    gridCellKm,
    depth,
    lang,
    proxies,
    workspace,
    resume,
  } = payload;

  // Directorio de trabajo. Si la ruta lo provee la app, se reutiliza para
  // poder reanudar una corrida interrumpida; si no, es temporal y se borra.
  const providedWorkspace = String(workspace || "").trim();
  const tmpDir = providedWorkspace
    ? providedWorkspace
    : await fs.mkdtemp(path.join(os.tmpdir(), "lead-scrape-"));
  const ownsTmpDir = !providedWorkspace;
  if (ownsTmpDir) {
    await fs.mkdir(tmpDir, { recursive: true });
  }

  const queriesPath = path.join(tmpDir, "queries.txt");
  const resultsPath = path.join(tmpDir, "results.json");
  const proxiesPath = path.join(tmpDir, "proxies.txt");

  // El directorio temporal propio se borra al terminar; el que provee la
  // app se conserva para poder reanudar la corrida.
  const cleanup = async () => {
    if (!ownsTmpDir) return;
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      // best effort
    }
  };

  try {
    let lines = Array.isArray(queries) && queries.length
      ? queries
      : [buildQuery(query, areaName, bounds)];

    // Modo grilla: la localizacion la aporta -grid-bbox, que lanza una
    // busqueda por celda (equivalente a "Buscar en esta area" de Maps).
    // NO se agrega el sufijo "near lat,lng" porque ese modificador de texto
    // cambia el orden de resultados respecto de la UI de Maps.
    const useGrid = Boolean(bbox);
    if (center && !useGrid) {
      const suffix = ` near ${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
      lines = lines.map((line) => `${line}${suffix}`);
    }

    await fs.writeFile(queriesPath, `${lines.join("\n")}\n`, "utf8");

    // Al reanudar NO se borra el results.json: el scraper lo lee, saltea los
    // lugares ya escritos y sigue agregando. Sin esto se perderia todo el
    // output parcial de una corrida interrumpida.
    const hasPartial =
      Boolean(resume) &&
      (await fs
        .stat(resultsPath)
        .then((s) => s.size > 0)
        .catch(() => false));
    if (!hasPartial) {
      await fs.writeFile(resultsPath, "", "utf8");
    }

    const geo = computeGeo(bounds, center, radiusKm);

    const cellKm = Number(gridCellKm) || 1;
    const zoomLevel = String(zoomForCell(cellKm));

    // Nombre unico: permite detener el contenedor concreto al cancelar.
    // La ruta lo genera y lo pasa en el payload para poder limpiarlo.
    const containerName =
      String(payload.containerName || "").trim() || `lead-scrape-${process.pid}-${Date.now()}`;

    // Proxies: reducen el rate limiting cuando se scrapea en volumen.
    // Van SIEMPRE por archivo (-proxies-file), nunca inline: la linea de
    // comandos del proceso docker.exe es legible por cualquier programa
    // del equipo y ahi quedarian las credenciales a la vista.
    const proxyList = parseProxies(proxies);
    if (proxyList.invalid.length && !proxyList.valid.length) {
      throw new Error(
        `Proxies invalidos: ${proxyList.invalid.length}. Formato esperado: http://user:pass@host:port o socks5://host:port`
      );
    }
    let proxiesMount = null;
    if (proxyList.valid.length) {
      await fs.writeFile(proxiesPath, `${proxyList.valid.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
      try {
        await fs.chmod(proxiesPath, 0o600);
      } catch (error) {
        // En Windows chmod es best effort.
      }
      proxiesMount = `${proxiesPath}:/proxies.txt`;
    }

    // Orden de `docker run`: las opciones de Docker (incluidos los -v) van
    // ANTES del nombre de la imagen; los flags de la app, despues.
    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      containerName,
      "-v",
      `${queriesPath}:/example-queries`,
      "-v",
      `${resultsPath}:/results.json`,
    ];
    if (proxiesMount) {
      dockerArgs.push("-v", proxiesMount);
    }

    const args = [
      ...dockerArgs,
      "gosom/google-maps-scraper",
      "-input",
      "/example-queries",
      "-results",
      "/results.json",
      "-json",
      "-depth",
      String(Number(depth) || 5),
      "-exit-on-inactivity",
      "3m",
    ];

    if (includeEmails) {
      args.push("-email");
    }

    // Idioma: Google Maps devuelve resultados distintos segun el locale.
    // Sin esto el scraper usa "en" y difiere de lo que ve el usuario en ES.
    if (lang) {
      args.push("-lang", String(lang));
    }

    if (useGrid) {
      args.push(
        "-grid-bbox",
        String(bbox),
        "-grid-cell",
        String(cellKm),
        "-zoom",
        zoomLevel
      );
    } else if (geo) {
      args.push("-geo", geo.geo, "-radius", String(geo.radiusMeters), "-zoom", zoomLevel);
    }

    // Reanudar: el scraper lee el results.json existente, saltea los lugares
    // ya escritos y sigue agregando los que faltan.
    if (hasPartial) {
      args.push("-resume");
    }

    if (proxiesMount) {
      // El flag va despues de la imagen; el mount ya esta en dockerArgs.
      args.push("-proxies-file", "/proxies.txt");
    }

    // Log a stderr (stdout es el protocolo JSON). Las credenciales de los
    // proxies van redactadas.
    process.stderr.write(`[scraper] docker ${redactArgs(args)}\n`);

    activeContainer = containerName;

    const { code, stderr } = await new Promise((resolve) => {
      const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
      let errorBuffer = "";

      child.stderr.on("data", (data) => {
        errorBuffer += data.toString();
      });

      child.on("close", (exitCode) => {
        // El contenedor termino por si solo: ya no hay nada que detener.
        if (activeContainer === containerName) activeContainer = null;
        resolve({ code: exitCode ?? 1, stderr: errorBuffer });
      });
    });

    // Red de seguridad: si el script muere por otra razon, el contenedor no
    // debe quedar huerfano consumiendo CPU y red.
    stopActiveContainer();

    if (code !== 0) {
      throw new Error(
        `Docker error (${code}). ${stderr || "No se pudo ejecutar el scraper."} [cmd: docker ${redactArgs(args)}]`
      );
    }

    // El archivo puede no existir si otra corrida lo borro (o si el volumen
    // se desmontó). No es motivo para perder la corrida entera: se avisa y
    // se devuelve lo que se haya podido leer.
    let raw = "";
    try {
      raw = await fs.readFile(resultsPath, "utf8");
    } catch (error) {
      process.stderr.write(
        `[scraper] no se pudo leer ${resultsPath}: ${error.message}\n`
      );
      return [];
    }
    const trimmed = raw.trim();
    if (!trimmed) return [];

    if (trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        process.stderr.write("[scraper] results.json ilegible como array, se intenta JSONL\n");
      }
    }

    // JSONL: una linea por lugar. Se saltea la linea que no se pueda parsear
    // en vez de perder el scrape completo (importante al reanudar).
    const parsed = [];
    trimmed
      .split(/\r?\n/)
      .map((line) => line.replace(/^\uFEFF/, "").trim())
      .filter(Boolean)
      .forEach((line, index) => {
        try {
          parsed.push(JSON.parse(line));
        } catch (error) {
          process.stderr.write(`[scraper] linea ${index + 1} ilegible, se omite\n`);
        }
      });
    return parsed;
  } finally {
    await cleanup();
  }
}

async function main() {
  try {
    const payload = await readStdin();
    const results = await runDockerScraper(payload);
    process.stdout.write(JSON.stringify({ ok: true, items: results }));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Error inesperado",
      })
    );
    process.exitCode = 1;
  }
}

main();

