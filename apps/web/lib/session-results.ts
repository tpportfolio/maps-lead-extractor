/**
 * Estado de una sesion de busqueda en disco.
 *
 * El scraper escribe los resultados en un archivo JSONL (una linea por lugar)
 * dentro de un workspace persistente por firma de busqueda. Ese archivo es el
 * estado de reanudacion: si la corrida se corta, queda con output parcial y la
 * siguiente corrida identica lo continua.
 *
 * Este modulo concentra la lectura, la escritura y la union de ese archivo.
 * La union es la parte importante: garantiza que el output parcial NUNCA se
 * pierde, incluso si el scraper deja el archivo incompleto o truncado.
 */

export type SessionItem = Record<string, unknown>;

/**
 * Identidad del lugar. Se usa place_id de Google cuando existe: es estable
 * entre corridas. Si no, cae a nombre + direccion.
 */
export function sessionItemKey(item: SessionItem): string {
  const placeId = String(item.placeId ?? item.place_id ?? item.cid ?? item.id ?? "").trim();
  if (placeId) return `id:${placeId}`;

  const name = String(item.title ?? item.name ?? item.businessName ?? "").trim().toLowerCase();
  const address = String(
    item.address ?? item.fullAddress ?? item.formattedAddress ?? ""
  )
    .trim()
    .toLowerCase();
  return `fallback:${name}|${address}`;
}

/**
 * Lee el archivo de resultados (JSONL). Tolera BOM, la ultima linea a medio
 * escribir (contenedor muerto en mitad de escritura) y lineas invalidas:
 * se omiten en vez de perder el resto del scrape.
 */
export async function readSessionResults(filePath: string): Promise<SessionItem[]> {
  let raw = "";
  try {
    const { readFile } = await import("fs/promises");
    raw = await readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const trimmed = raw.replace(/^\uFEFF/, "").trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as SessionItem[];
    } catch {
      // No es un array valido: se intenta como JSONL.
    }
  }

  const items: SessionItem[] = [];
  trimmed.split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    if (!clean) return;
    try {
      items.push(JSON.parse(clean) as SessionItem);
    } catch {
      // Linea a medias: se omite.
    }
  });
  return items;
}

/** Escribe el archivo de resultados en JSONL (mismo formato que usa el scraper). */
export async function writeSessionResults(
  filePath: string,
  items: SessionItem[]
): Promise<void> {
  const { writeFile } = await import("fs/promises");
  const body = items.map((item) => JSON.stringify(item)).join("\n");
  await writeFile(filePath, body ? `${body}\n` : "", "utf8");
}

/**
 * Une varias fuentes de items en una sola lista sin duplicados.
 * El orden importa: el primero que aparece gana, asi que conviene pasar
 * primero los datos mas frescos (lo que devolvio el scraper).
 */
export function mergeSessionResults(...groups: SessionItem[][]): SessionItem[] {
  const seen = new Set<string>();
  const merged: SessionItem[] = [];

  for (const group of groups) {
    for (const item of group) {
      if (!item || typeof item !== "object") continue;
      const key = sessionItemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  return merged;
}
