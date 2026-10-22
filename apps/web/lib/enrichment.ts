// V2 — lógica outbound-ready sin dependencias pagas.
// Owner heurístico + email waterfall + intent + local fact + copy/call.
// Reutilizable en cliente y servidor (sin Node APIs).

export type OwnerConfidence = "high" | "medium" | "low" | "not_found";

export interface OwnerGuess {
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  confidence: OwnerConfidence;
  source: string;
}

export interface IntentResult {
  score: number;
  signals: {
    reviewBurst: boolean;
    lowRatingWithVolume: boolean;
    noWebsite: boolean;
    slowOrPoorWeb: boolean;
    hiringSignal: boolean;
    freshListing: boolean;
  };
  priority: "alta" | "media" | "baja";
}

const OWNER_TITLES = [
  "owner",
  "founder",
  "co-founder",
  "principal",
  "doctor",
  "dra",
  "dr",
  "director",
  "gerente",
  "propietario",
  "titular",
  "socio",
];

const GENERAL_PREFIXES = new Set([
  "info",
  "contact",
  "contacto",
  "hello",
  "hola",
  "ventas",
  "sales",
  "admin",
  "office",
  "team",
  "support",
  "soporte",
  "reservas",
  "turnos",
]);

export function emailTypeOf(email: string): "named" | "general" | "unknown" {
  const prefix = email.split("@")[0]?.toLowerCase().trim() ?? "";
  if (!prefix || !email.includes("@")) return "unknown";
  if (GENERAL_PREFIXES.has(prefix)) return "general";
  // named si parece nombre.apellido / inicial
  if (/^[a-zñ]+\.[a-zñ]+/i.test(prefix) || /^[a-zñ]+$/.test(prefix)) return "named";
  return "unknown";
}

// Waterfall local V2: scraper emails -> crawl text -> pattern guess.
// No llama a APIs pagas; deja log de source para decidir gasto futuro.
export function waterfallEmails(input: {
  scraperEmails: string[];
  websiteText?: string;
  domain?: string;
  ownerFirst?: string;
  ownerLast?: string;
}): { email: string; source: "scraper" | "crawl" | "pattern" | "unknown"; candidates: string[] } {
  const clean = (arr: string[]) =>
    Array.from(new Set(arr.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"))));
  const fromScraper = clean(input.scraperEmails);
  if (fromScraper.length) {
    return { email: fromScraper[0], source: "scraper", candidates: fromScraper };
  }
  const textEmails = clean(
    (input.websiteText ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  );
  if (textEmails.length) {
    return { email: textEmails[0], source: "crawl", candidates: textEmails };
  }
  if (input.domain && input.ownerFirst) {
    const d = input.domain.replace(/^www\./, "").toLowerCase();
    const f = input.ownerFirst.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const l = (input.ownerLast ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const guess = l ? `${f}.${l}@${d}` : `${f}@${d}`;
    return { email: guess, source: "pattern", candidates: [guess] };
  }
  return { email: "", source: "unknown", candidates: [] };
}

// Owner finder heurístico: busca "Nombre + título" en texto de About/Team/Footer.
// Si no hay certeza devuelve not_found (regla que protege dominios del curso).
export function guessOwnerFromTexts(pages: { url: string; text: string }[]): OwnerGuess {
  const notFound: OwnerGuess = {
    firstName: "",
    lastName: "",
    fullName: "",
    title: "",
    confidence: "not_found",
    source: "none",
  };
  const joined = pages.map((p) => p.text).join("\n").slice(0, 20000);
  if (!joined.trim()) return notFound;

  // Patrón: Nombre Apellido cerca de título
  const titleAlt = OWNER_TITLES.join("|");
  const re = new RegExp(
    `([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)[^\\n]{0,40}?(${titleAlt})`,
    "i"
  );
  const m = joined.match(re);
  if (m) {
    const fullName = `${m[1]} ${m[2]}`.trim();
    const title = m[3] ?? "";
    return {
      firstName: m[1] ?? "",
      lastName: m[2] ?? "",
      fullName,
      title,
      confidence: "medium",
      source: pages[0]?.url ?? "website",
    };
  }
  // Fallback: "Dr. Nombre Apellido"
  const dr = joined.match(/(?:Dr\.?|Dra\.?)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/);
  if (dr) {
    const parts = dr[1].trim().split(/\s+/);
    return {
      firstName: parts[0] ?? "",
      lastName: parts.slice(1).join(" "),
      fullName: dr[1].trim(),
      title: "doctor",
      confidence: "medium",
      source: pages[0]?.url ?? "website",
    };
  }
  return notFound;
}

export function scoreIntent(input: {
  rating?: number;
  reviews?: number;
  hasWebsite: boolean;
  auditScore?: number;
  websiteText?: string;
}): IntentResult {
  const signals = {
    reviewBurst: false,
    lowRatingWithVolume: false,
    noWebsite: !input.hasWebsite,
    slowOrPoorWeb: input.auditScore !== undefined && input.auditScore < 60,
    hiringSignal: false,
    freshListing: false,
  };
  let score = 50;
  const reviews = input.reviews ?? 0;
  const rating = input.rating ?? 0;

  // Volumen sano: ni micro (5) ni chain gigante
  if (reviews >= 20 && reviews <= 500) score += 10;
  if (reviews > 500) score -= 10;
  if (reviews < 10) score -= 10;

  // Rating 3.0-4.2 con volumen = oportunidad (mejora visible)
  if (reviews >= 20 && rating >= 3.0 && rating <= 4.2) {
    signals.lowRatingWithVolume = true;
    score += 15;
  }
  if (rating >= 4.5 && reviews >= 50) score += 5; // prueba social, buen caso

  if (signals.noWebsite) score += 15;
  if (signals.slowOrPoorWeb) score += 12;

  const txt = (input.websiteText ?? "").toLowerCase();
  if (/(hiring|we're hiring|trabaja con nosotros|empleo|vacante|designer|buscamos)/.test(txt)) {
    signals.hiringSignal = true;
    score += 8;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const priority = score >= 70 ? "alta" : score >= 45 ? "media" : "baja";
  return { score, signals, priority };
}

export function buildLocalFact(input: {
  businessName: string;
  area: string;
  rating?: number;
  competitorName?: string;
}): string {
  if (input.competitorName) {
    return `${input.competitorName} viene sumando reseñas en ${input.area}`;
  }
  if (input.rating !== undefined && input.rating >= 4) {
    return `${input.businessName} mantiene ${input.rating.toFixed(1)}★ en ${input.area}`;
  }
  return `movimiento reciente en ${input.area}`;
}

export function buildIcebreaker(input: {
  firstName: string;
  businessType: string;
  area: string;
  localFact: string;
}): string {
  const name = input.firstName || "Hola";
  return `${name}, noté que ${input.localFact}. Ayudamos a ${input.businessType} en ${input.area} a convertir eso en más trabajos agendados desde Google. ¿Te mando una comparación rápida de dónde rankeás vs ellos?`;
}

export function buildCallScript(input: {
  businessName: string;
  localFact: string;
}): string {
  return `Hola, llamo por ${input.businessName}. Vi que ${input.localFact}. ¿Eso les está costando trabajos este mes? Tengo 2 horarios para mostrarte cómo rankean vs la zona: ¿hoy 16:30 o mañana 11:00?`;
}

