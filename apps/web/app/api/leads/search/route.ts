import { spawn, spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";
// Tipos oficiales de Google Places (Tabla A, 478 tipos en 19 grupos).
// El id de Google se usa directo como query en Maps.
import {
  ALL_PLACE_TYPES,
  HIGH_TICKET_TYPES,
  placeTypeToQuery,
} from "../../../../../../packages/shared/constants/place-types";
import {
  mergeSessionResults,
  readSessionResults as readSessionResultsFile,
  writeSessionResults as writeSessionResultsFile,
} from "../../../../lib/session-results";

type Center = {
  lat: number;
  lng: number;
};

type ScraperResponse = {
  ok: boolean;
  items?: unknown[];
  error?: string;
};

/**
 * Sesion de busqueda persistente.
 *
 * El scraper escribe los resultados en un archivo. Si la corrida se corta
 * (Docker muere, se cancela, se reinicia la maquina), ese archivo queda
 * con output parcial. Con `-resume` el scraper lo lee, saltea los lugares
 * ya escritos y sigue agregando los que faltan.
 *
 * La sesion se identifica por una firma de la busqueda: si el usuario
 * repite la MISMA busqueda, se reanuda; si cambia algo, arranca de cero.
 */

function searchSignature(input: {  query: string;
  customKeyword: string;
  radiusKm: number;
  center: Center | null;
  depth: number;
  lang: string;
  includeEmails: boolean;
}): string {
  const center = input.center
    ? `${input.center.lat.toFixed(5)},${input.center.lng.toFixed(5)}`
    : "none";
  return [
    input.query.trim().toLowerCase(),
    input.customKeyword.trim().toLowerCase(),
    String(input.radiusKm),
    center,
    String(input.depth),
    input.lang,
    input.includeEmails ? "em" : "noem",
  ].join("|");
}

function sessionWorkspace(signature: string): string {
  const root = path.join(os.tmpdir(), "lead-extract-sessions");
  const hash = crypto.createHash("sha1").update(signature).digest("hex").slice(0, 16);
  return path.join(root, hash);
}

async function fileHasContent(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.size > 0;
  } catch {
    return false;
  }
}

/**
 * El archivo results.json del workspace ES el estado de reanudacion.
 * - Si la corrida anterior quedo a medias, el archivo tiene output parcial
 *   y la siguiente corrida identica lo reanuda (el scraper lo lee, saltea
 *   los lugares ya escritos y sigue agregando los que faltan).
 * - Si la corrida termino bien, el archivo se borra y la siguiente arranca
 *   de cero.
 * No depende de estado en memoria: sobrevive reinicios del server.
 */
async function resolveSession(
  signature: string,
  opts: { fresh: boolean }
): Promise<{
  workspace: string;
  resume: boolean;
  resultsFile: string;
  previous: Record<string, unknown>[];
}> {
  const workspace = sessionWorkspace(signature);
  await fs.mkdir(workspace, { recursive: true });

  const resultsFile = path.join(workspace, "results.json");
  const resume = !opts.fresh && (await fileHasContent(resultsFile));

  if (opts.fresh) {
    await fs.rm(resultsFile, { force: true });
    await fs.rm(`${resultsFile}.resume.json`, { force: true });
  }

  // Lo que ya habia en disco. Se guarda aparte para poder restaurarlo si
  // el scraper deja el archivo incompleto o truncado: el output parcial
  // NUNCA se pierde, ni siquiera con una corrida interrumpida.
  const previous = resume ? await readSessionResultsFile(resultsFile) : [];

  return { workspace, resume, resultsFile, previous };
}

/**
 * Persiste el estado de la sesion uniendo tres fuentes:
 *   previous  -> lo que habia en disco antes de la corrida
 *   current   -> lo que el scraper dejo escrito en el archivo
 *   extra     -> lo que el scraper devolvio por stdout
 *
 * Los datos mas frescos (stdout) pisan a los viejos cuando coinciden, y el
 * archivo queda siempre con la union completa: la siguiente corrida puede
 * reanudar desde ahi sin perder nada.
 */
async function persistSession(
  resultsFile: string,
  previous: Record<string, unknown>[],
  extra: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const current = await readSessionResultsFile(resultsFile);
  const merged = mergeSessionResults([...extra, ...current, ...previous]);
  try {
    await writeSessionResultsFile(resultsFile, merged);
  } catch {
    // Si no se puede escribir, al menos se devuelven los items unidos.
  }
  return merged;
}

async function markSession(workspace: string, completed: boolean) {
  if (!completed) return; // corrida interrumpida: se conserva el output parcial
  // La corrida termino bien: no queda nada pendiente que reanudar.
  await fs.rm(path.join(workspace, "results.json"), { force: true }).catch(() => {});
  await fs.rm(path.join(workspace, "results.json.resume.json"), { force: true }).catch(() => {});
}

/**
 * Lock por sesion.
 *
 * Dos corridas simultaneas sobre la misma busqueda se pisan: ambas escriben
 * en el mismo results.json y la que termina primero lo borra, dejando a la
 * otra sin archivo (ENOENT) o con un conteo corrupto. El lock garantiza que
 * solo haya una corrida activa por workspace.
 *
 * Si el proceso que dejo el lock ya no existe (el server se reinicio), el
 * lock se pisa en el acto: no queda bloqueada la app. Si el proceso sigue
 * vivo pero el lock es viejo, tambien se pisa (posible proceso colgado).
 */
const LOCK_TTL_MS = 30 * 60 * 1000;

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireSessionLock(
  workspace: string
): Promise<{ release: () => Promise<void> } | null> {
  const lockFile = path.join(workspace, "run.lock");
  const payload = JSON.stringify({ pid: process.pid, startedAt: Date.now() });

  try {
    // "wx" falla si el archivo ya existe.
    await fs.writeFile(lockFile, payload, { encoding: "utf8", flag: "wx" });
  } catch {
    // Ya hay un lock: se pisa solo si su dueno ya no existe o es muy viejo.
    try {
      const raw = await fs.readFile(lockFile, "utf8");
      const owner = (JSON.parse(raw) as { pid?: number }).pid;
      const stat = await fs.stat(lockFile);
      const stale = Date.now() - stat.mtimeMs > LOCK_TTL_MS;
      if (processAlive(Number(owner)) && !stale) return null;
      await fs.writeFile(lockFile, payload, "utf8");
    } catch {
      return null;
    }
  }

  return {
    release: async () => {
      await fs.rm(lockFile, { force: true }).catch(() => {});
    },
  };
}

// Alias en espanol que no son ids exactos de Google pero tienen equivalente cercano.
const TYPE_QUERY_ALIASES: Record<string, string[]> = {
  Carniceria: ["butcher shop", "carniceria", "charcuteria"],
  Avicola: ["poultry shop", "pollero", "aves"],
  CarniceriaAvicola: ["butcher shop", "poultry shop", "carniceria", "pollero"],
  Plomero: ["plumber", "plomeria", "plomero"],
  Electricista: ["electrician", "electricista"],
  Techos: ["roofing contractor", "roofer", "techos"],
  Abogado: ["lawyer", "estudio juridico", "abogado"],
  Contador: ["accounting", "contador", "estudio contable"],
  Clinica: ["medical clinic", "clinica medica", "consultorio"],
  Gimnasio: ["gym", "fitness center", "gimnasio"],
  Hotel: ["hotel", "hostel", "alojamiento"],
  Restaurante: ["restaurant", "restaurante"],
  Farmacia: ["pharmacy", "farmacia"],
  Kiosco: ["convenience store", "kiosco", "almacen"],
  Veterinaria: ["veterinary care", "veterinaria"],
  Inmobiliaria: ["real estate agency", "inmobiliaria"],
  Taller: ["car repair", "taller mecanico"],
  Ferreteria: ["hardware store", "ferreteria"],
  Peluqueria: ["hair salon", "peluqueria"],
  Panaderia: ["bakery", "panaderia"],
  Supermercado: ["supermarket", "supermercado"],
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function runScraper(payload: Record<string, unknown>, signal?: AbortSignal) {
  const scriptPath = path.join(
    process.cwd(),
    "..",
    "..",
    "services",
    "scraper",
    "src",
    "run-google-maps.js"
  );

  // Nombre del contenedor: lo genera la ruta para poder detenerlo al cancelar.
  const containerName = `lead-scrape-${process.pid}-${Date.now()}`;

  return new Promise<ScraperResponse>((resolve, reject) => {
    const child = spawn("node", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    let errorOutput = "";
    let finished = false;

    const abortHandler = () => {
      if (finished) return;
      finished = true;
      try {
        child.kill("SIGTERM");
      } catch (error) {
        // ignore
      }
      // En Windows, child.kill() termina el proceso sin ejecutar sus
      // handlers de senal, asi que el contenedor de Docker quedaria
      // huerfano (sigue raspando). Se detiene explicitamente.
      try {
        spawnSync("docker", ["stop", "-t", "5", containerName], {
          stdio: "ignore",
          timeout: 20000,
        });
      } catch (error) {
        // ignore
      }
      reject(new Error("Busqueda cancelada."));
    };

    if (signal) {
      if (signal.aborted) {
        abortHandler();
        return;
      }
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("close", () => {
      if (finished) return;
      finished = true;
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }

      // El scraper loguea a stderr (comando docker, warnings). Se deja en la
      // consola del server: es la unica traza de que paso en el contenedor.
      if (errorOutput.trim()) {
        console.error(`[leads/search] scraper stderr:\n${errorOutput.trim()}`);
      }

      if (!output) {
        reject(new Error(errorOutput.trim() || "No hubo respuesta del scraper."));
        return;
      }

      try {
        const parsed = JSON.parse(output) as ScraperResponse;
        if (!parsed.ok) {
          const detail = errorOutput.trim().split("\n").slice(-3).join(" ");
          reject(
            new Error(
              [parsed.error || "Error al ejecutar el scraper.", detail]
                .filter(Boolean)
                .join(" ")
            )
          );
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(new Error("Respuesta invalida del scraper."));
      }
    });

    child.stdin.write(JSON.stringify({ ...payload, containerName }));
    child.stdin.end();
  });
}

function parseCoordinates(value: unknown): { lat?: number; lng?: number } {
  if (!value) return {};
  if (typeof value === "string") {
    const parts = value.split(",").map((part) => Number(part.trim()));
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      return { lat: parts[0], lng: parts[1] };
    }
  }
  if (Array.isArray(value) && value.length >= 2) {
    const lat = Number(value[0]);
    const lng = Number(value[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const lat = Number(obj.lat ?? obj.latitude);
    const lng = Number(obj.lng ?? obj.longitude ?? obj.longtitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }
  return {};
}

function deepFindCoords(value: unknown, depth = 0): { lat?: number; lng?: number } {
  if (!value || depth > 4) return {};
  const parsed = parseCoordinates(value);
  if (parsed.lat !== undefined && parsed.lng !== undefined) return parsed;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = deepFindCoords(entry, depth + 1);
      if (found.lat !== undefined && found.lng !== undefined) return found;
    }
    return {};
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const found = deepFindCoords(obj[key], depth + 1);
      if (found.lat !== undefined && found.lng !== undefined) return found;
    }
  }
  return {};
}

function getLeadCoords(item: Record<string, unknown>) {
  const directLat = Number(item.latitude ?? item.lat ?? item.locationLat);
  const directLng = Number(item.longitude ?? item.longtitude ?? item.lng ?? item.locationLng);
  if (Number.isFinite(directLat) && Number.isFinite(directLng)) {
    return { lat: directLat, lng: directLng };
  }
  const nestedLocation = item.location as Record<string, unknown> | undefined;
  if (nestedLocation) {
    const nestedLat = Number(nestedLocation.lat ?? nestedLocation.latitude);
    const nestedLng = Number(nestedLocation.lng ?? nestedLocation.longitude);
    if (Number.isFinite(nestedLat) && Number.isFinite(nestedLng)) {
      return { lat: nestedLat, lng: nestedLng };
    }
  }
  const geometry = (item.geometry as Record<string, unknown> | undefined)?.location as
    | Record<string, unknown>
    | undefined;
  if (geometry) {
    const geoLat = Number(geometry.lat ?? geometry.latitude);
    const geoLng = Number(geometry.lng ?? geometry.longitude);
    if (Number.isFinite(geoLat) && Number.isFinite(geoLng)) {
      return { lat: geoLat, lng: geoLng };
    }
  }
  const gpsCoordinates = item.gps_coordinates ?? item.gpsCoordinates;
  const parsed = parseCoordinates(
    item.gps ?? item.coordinates ?? item.position ?? item.geo ?? gpsCoordinates
  );
  if (parsed.lat !== undefined && parsed.lng !== undefined) return parsed;

  return deepFindCoords(item);
}

function hasCoords(item: Record<string, unknown>) {
  const coords = getLeadCoords(item);
  return coords.lat !== undefined && coords.lng !== undefined;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

function splitByRadius(items: Record<string, unknown>[], center: Center | null, radiusKm: number) {
  if (!center || !Number.isFinite(radiusKm)) {
    return { inside: items, outside: [], unknown: [] };
  }
  const inside: Record<string, unknown>[] = [];
  const outside: Record<string, unknown>[] = [];
  const unknown: Record<string, unknown>[] = [];

  items.forEach((item) => {
    const coords = getLeadCoords(item);
    if (coords.lat === undefined || coords.lng === undefined) {
      unknown.push(item);
      return;
    }
    const distance = haversineKm(center.lat, center.lng, coords.lat, coords.lng);
    if (distance <= radiusKm) inside.push(item);
    else outside.push(item);
  });

  return { inside, outside, unknown };
}
function sortByDistance(items: Record<string, unknown>[], center: Center | null) {
  if (!center) return items;
  return [...items].sort((a, b) => {
    const aCoords = getLeadCoords(a);
    const bCoords = getLeadCoords(b);
    const aDistance =
      aCoords.lat !== undefined && aCoords.lng !== undefined
        ? haversineKm(center.lat, center.lng, aCoords.lat, aCoords.lng)
        : Number.POSITIVE_INFINITY;
    const bDistance =
      bCoords.lat !== undefined && bCoords.lng !== undefined
        ? haversineKm(center.lat, center.lng, bCoords.lat, bCoords.lng)
        : Number.POSITIVE_INFINITY;
    return aDistance - bDistance;
  });
}

function makeDedupeKey(item: Record<string, unknown>) {
  const placeId = String(item.placeId ?? item.place_id ?? item.cid ?? item.id ?? "").trim();
  if (placeId) return `id:${placeId}`;

  // V2: dedupe curso = name + city + domain (más robusto que coords)
  const rawName = String(item.title ?? item.name ?? item.businessName ?? "").trim().toLowerCase();
  const rawCity = String(
    item.city ?? item.locality ?? item.address ?? item.fullAddress ?? item.formattedAddress ?? ""
  )
    .trim()
    .toLowerCase()
    .slice(0, 80);
  const rawWebsite = String(
    item.website ?? item.web_site ?? item.webSite ?? item.website_url ?? item.site ?? item.url ?? ""
  ).trim().toLowerCase();
  let domain = "";
  try {
    if (rawWebsite) {
      const withProto = rawWebsite.startsWith("http") ? rawWebsite : `https://${rawWebsite}`;
      domain = new URL(withProto).hostname.replace(/^www\./, "");
    }
  } catch {
    domain = rawWebsite.slice(0, 60);
  }
  if (rawName || rawCity || domain) {
    return `v2:${rawName}|${rawCity}|${domain}`;
  }

  const coords = getLeadCoords(item);
  const lat = coords.lat !== undefined ? coords.lat.toFixed(5) : "na";
  const lng = coords.lng !== undefined ? coords.lng.toFixed(5) : "na";
  const name = String(item.title ?? item.name ?? item.businessName ?? "").trim().toLowerCase();
  const address = String(item.address ?? item.fullAddress ?? item.formattedAddress ?? "")
    .trim()
    .toLowerCase();

  return `fallback:${name}|${address}|${lat}|${lng}`;
}

type Bbox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

/**
 * Bounding box del radio alrededor del centro.
 * El scraper lo usa con -grid-bbox para partir el area en celdas
 * y hacer una busqueda por celda (igual que Maps al hacer zoom out).
 */
function buildBbox(center: Center, radiusKm: number): Bbox {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.25));
  return {
    minLat: +(center.lat - latDelta).toFixed(6),
    minLon: +(center.lng - lngDelta).toFixed(6),
    maxLat: +(center.lat + latDelta).toFixed(6),
    maxLon: +(center.lng + lngDelta).toFixed(6),
  };
}

function bboxToString(bbox: Bbox): string {
  return `${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon}`;
}

function dedupeItems(items: Record<string, unknown>[]) {
  const map = new Map<string, Record<string, unknown>>();
  items.forEach((item) => {
    const key = makeDedupeKey(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  });
  return Array.from(map.values());
}
function extractCandidateKeys(item: Record<string, unknown>) {
  return Object.keys(item).filter((key) =>
    /(lat|lng|lon|long|coord|geo|gps|location|pos)/i.test(key)
  );
}

function parseReviewCount(item: Record<string, unknown>): number | undefined {
  const raw =
    item.reviews ??
    item.reviewCount ??
    item.reviewsCount ??
    item.review_count ??
    (item.reviews_per_rating as unknown);
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  if (raw && typeof raw === "object") return undefined;
  return undefined;
}

function parseRating(item: Record<string, unknown>): number | undefined {
  const raw = item.rating ?? item.stars ?? item.avgRating ?? item.review_rating;
  const n = Number(String(raw ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function looksLikeChain(item: Record<string, unknown>): boolean {
  const name = String(item.title ?? item.name ?? item.businessName ?? "").toLowerCase();
  const chains = ["mcdonald", "starbucks", "subway", "walmart", "oxxo", "carrefour", "dia %", "mostaza", "grido", "havanna"];
  return chains.some((c) => c.replace("%", "").trim() && name.includes(c.replace("%", "").trim()));
}

function buildQueries(query: string, customKeyword?: string) {
  const custom = String(customKeyword ?? "").trim();
  // Keyword libre del usuario: manda sobre todo.
  if (custom) {
    const alias = TYPE_QUERY_ALIASES[custom] ?? TYPE_QUERY_ALIASES[normalizeText(custom)];
    return Array.from(new Set([custom, ...(alias ?? [])]));
  }

  const normalized = normalizeText(query);
  if (normalized.toUpperCase() === "TODAS") {
    return Array.from(new Set(HIGH_TICKET_TYPES));
  }

  // Tipo oficial de Google (id con guion bajo) -> query directa.
  if (ALL_PLACE_TYPES.includes(query)) {
    return [placeTypeToQuery(query)];
  }

  const alias = TYPE_QUERY_ALIASES[query] ?? TYPE_QUERY_ALIASES[normalized];
  if (alias) return Array.from(new Set(alias));

  return [query];
}

export async function POST(request: Request) {
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    const body = await request.json();
    const query = String(body.query ?? "Negocios").trim();
    const radiusKm = Number(body.radiusKm ?? 0.5);
    const center = (body.center as Center | undefined) ?? null;
    const strictRadius = body.strictRadius !== undefined ? Boolean(body.strictRadius) : false;
    // V2 filtros curso
    const minReviews = body.minReviews !== undefined && body.minReviews !== "" ? Number(body.minReviews) : undefined;
    const maxReviews = body.maxReviews !== undefined && body.maxReviews !== "" ? Number(body.maxReviews) : undefined;
    const minRating = body.minRating !== undefined && body.minRating !== "" ? Number(body.minRating) : undefined;
    const onlyWithPhone = Boolean(body.onlyWithPhone ?? false);
    const onlyWithWebsite = Boolean(body.onlyWithWebsite ?? false);
    const excludeChains = Boolean(body.excludeChains ?? false);
    const suppressedKeys = new Set(
      (Array.isArray(body.suppressedKeys) ? body.suppressedKeys : []).map((k: unknown) => String(k))
    );

    const queries = buildQueries(query, body.customKeyword);

    // Modo grilla: una sola corrida del scraper que cubre todo el radio.
    // El scraper divide el bbox en celdas y hace una busqueda por celda,
    // que es lo mismo que "Buscar en esta area" de Google Maps.
    const depth = body.depth !== undefined ? Number(body.depth) : 5;
    const lang = body.lang ? String(body.lang) : "es";
    const bbox = center ? buildBbox(center, radiusKm) : null;
    const gridCellKm = center ? Math.min(3, Math.max(0.25, radiusKm / 2)) : 1;
    // -email hace que el scraper raspe cada web de negocio buscando emails.
    // Es redundante si despues se corre Enriquecer (que usa cache + pool).
    const includeEmails = body.includeEmails !== undefined ? Boolean(body.includeEmails) : false;
    // Proxies: lista separada por comas. Se validan en el scraper y viajan
    // por archivo (-proxies-file), nunca en la linea de comandos.
    const proxies = String(body.proxies ?? "").trim();

    // Sesion de busqueda: si se repite la MISMA busqueda y la corrida
    // anterior quedo a medias, se reanuda en vez de arrancar de cero.
    const signature = searchSignature({
      query,
      customKeyword: String(body.customKeyword ?? "").trim(),
      radiusKm,
      center,
      depth,
      lang,
      includeEmails,
    });
    // Lock por sesion: solo una corrida activa por busqueda. Sin esto, dos
    // corridas simultaneas se pisan el mismo results.json y una borra el
    // archivo que la otra esta usando.
    const workspace = sessionWorkspace(signature);
    await fs.mkdir(workspace, { recursive: true });
    const lock = await acquireSessionLock(workspace);
    if (!lock) {
      return NextResponse.json(
        {
          error:
            "Ya hay una busqueda en curso para esta misma busqueda. Esperala o cancelala antes de volver a buscar.",
        },
        { status: 409 }
      );
    }
    releaseLock = lock.release;

    const session = await resolveSession(signature, {
      fresh: Boolean(body.fresh ?? false),
    });
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    console.log(
      `[leads/search] run=${runId} sesion=${path.basename(session.workspace)} previos=${session.previous.length} resume=${session.resume} fresh=${Boolean(body.fresh ?? false)}`
    );

    const settled = await Promise.allSettled([
      runScraper(
        {
          query: String(body.customKeyword ?? "").trim() || query,
          queries,
          areaName: "",
          radiusKm,
          center,
          bbox: bbox ? bboxToString(bbox) : "",
          gridCellKm,
          depth,
          lang,
          includeEmails,
          proxies,
          workspace: session.workspace,
          resume: session.resume,
        },
        request.signal
      ),
    ]);

    const successful = settled
      .filter((entry): entry is PromiseFulfilledResult<ScraperResponse> => entry.status === "fulfilled")
      .map((entry) => (entry.value.items ?? []) as Record<string, unknown>[]);

    if (!successful.length) {
      const firstError = settled.find(
        (entry): entry is PromiseRejectedResult => entry.status === "rejected"
      );
      // La corrida fallo: se conserva el output parcial para poder reanudar.
      // Se reescribe el archivo con lo que habia + lo que el scraper alcanzó
      // a escribir, para que una corrida interrumpida no pierda nada.
      await persistSession(session.resultsFile, session.previous, []);
      throw new Error(firstError?.reason instanceof Error ? firstError.reason.message : "No se pudo ejecutar el scraper.");
    }

    // Merge defensivo: la union de lo anterior, lo que dejo el scraper en el
    // archivo y lo que devolvio por stdout. Asi el output parcial nunca se
    // pierde, aunque el scraper deje el archivo incompleto.
    const rawItems = await persistSession(
      session.resultsFile,
      session.previous,
      dedupeItems(successful.flat())
    );
    // Corrida completa: la sesion queda cerrada y no se reanuda.
    await markSession(session.workspace, true);
    // V2: filtros post-scrape (review count / rating / phone / web / chains / supresión)
    const preFilterCount = rawItems.length;
    const filteredByQuality = rawItems.filter((item) => {
      const rc = parseReviewCount(item);
      const rating = parseRating(item);
      if (minReviews !== undefined && Number.isFinite(minReviews) && (rc === undefined || rc < minReviews)) return false;
      if (maxReviews !== undefined && Number.isFinite(maxReviews) && rc !== undefined && rc > maxReviews) return false;
      if (minRating !== undefined && Number.isFinite(minRating) && rating !== undefined && rating < minRating) return false;
      if (onlyWithPhone) {
        const phone = String(item.phone ?? item.phoneNumber ?? item.phone_number ?? "").trim();
        if (!phone) return false;
      }
      if (onlyWithWebsite) {
        const web = String(item.website ?? item.web_site ?? item.webSite ?? item.website_url ?? item.site ?? item.url ?? "").trim();
        if (!web) return false;
      }
      if (excludeChains && looksLikeChain(item)) return false;
      if (suppressedKeys.size > 0 && suppressedKeys.has(makeDedupeKey(item))) return false;
      return true;
    });
    const radiusSplit = splitByRadius(filteredByQuality, center, radiusKm);
    const insideSorted = sortByDistance(radiusSplit.inside, center);
    const outsideSorted = sortByDistance(radiusSplit.outside, center);
    const items = strictRadius
      ? insideSorted
      : [...insideSorted, ...outsideSorted, ...radiusSplit.unknown];
    const sample = items[0] ?? rawItems[0] ?? null;

    return NextResponse.json({
      count: items.length,
      items,
      query,
      radiusKm,
      center,
      resumed: session.resume,
      // Cuantos leads venian de la corrida anterior (0 si arranco de cero).
      previousCount: session.previous.length,
      stats: {
        total: filteredByQuality.length,
        rawTotal: preFilterCount,
        filteredOut: preFilterCount - filteredByQuality.length,
        withCoords: filteredByQuality.filter(hasCoords).length,
        inArea: radiusSplit.inside.length,
        outside: radiusSplit.outside.length,
        unknown: radiusSplit.unknown.length,
      },
      debug: sample
        ? {
            sampleKeys: Object.keys(sample),
            coordinateKeys: extractCandidateKeys(sample),
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo ejecutar el scraper.",
      },
      { status: 500 }
    );
  } finally {
    // El lock se libera siempre: si no, la sesion quedaria bloqueada.
    if (releaseLock) await releaseLock();
  }
}






