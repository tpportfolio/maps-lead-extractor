// Esquema de export curado.
// Los campos crudos del scraper (38) se filtran: JSON blobs, duplicados y
// metadatos internos no aportan a un outbound. Solo sobrevive lo accionable.

export type ExportLead = {
  id: string;
  name: string;
  category: string;
  address: string;
  phone: string;
  website: string;
  emails: string;
  rating: string;
  reviews: string;
  priceRange: string;
  status: string;
  ownerClaimed: string;
  thumbnail: string;
  mapsLink: string;
  placeId: string;
  latitude?: number;
  longitude?: number;
};

export type ExportEnrichment = {
  ownerFirst: string;
  ownerLast: string;
  ownerTitle: string;
  ownerConfidence: string;
  emailType: string;
  emailSource: string;
  emailStatus: string;
  intentScore: string;
  intentPriority: string;
  localFact: string;
  competitorNearby: string;
  icebreaker: string;
  callScript: string;
  callPriority: string;
  auditScore: string;
  auditIssues: string;
};

export type ExportSection = "identidad" | "contacto" | "senal" | "enrichment" | "geo";

export type ExportField = {
  key: string;
  label: string;
  section: ExportSection;
  /** Peso relativo de la columna en el PDF (0 = no se muestra). */
  weight?: number;
  get: (lead: ExportLead, enr: ExportEnrichment) => string;
};

/**
 * Campos del export, en orden de lectura.
 * Los "weight" definen el ancho relativo en el PDF (solo los > 0 van).
 */
export const EXPORT_FIELDS: ExportField[] = [
  // --- Identidad ---
  { key: "nombre", label: "Nombre", section: "identidad", weight: 3, get: (l) => l.name },
  { key: "categoria", label: "Categoria", section: "identidad", weight: 1.4, get: (l) => l.category },
  { key: "direccion", label: "Direccion", section: "identidad", weight: 2, get: (l) => l.address },
  { key: "estado_negocio", label: "Estado", section: "identidad", weight: 0, get: (l) => l.status },

  // --- Contacto ---
  { key: "telefono", label: "Telefono", section: "contacto", weight: 1.2, get: (l) => l.phone },
  { key: "web", label: "Web", section: "contacto", weight: 1.6, get: (l) => l.website },
  { key: "emails", label: "Emails", section: "contacto", weight: 1.6, get: (l) => l.emails },
  { key: "tipo_email", label: "Tipo email", section: "contacto", weight: 0, get: (_l, e) => e.emailType },
  { key: "origen_email", label: "Origen email", section: "contacto", weight: 0, get: (_l, e) => e.emailSource },
  { key: "estado_email", label: "Estado email", section: "contacto", weight: 0, get: (_l, e) => e.emailStatus },
  { key: "owner_claim", label: "Perfil Maps", section: "contacto", weight: 0, get: (l) => l.ownerClaimed },

  // --- Senal ---
  { key: "rating", label: "Rating", section: "senal", weight: 0.7, get: (l) => l.rating },
  { key: "resenas", label: "Resenas", section: "senal", weight: 0.7, get: (l) => l.reviews },
  { key: "precio", label: "Precio", section: "senal", weight: 0, get: (l) => l.priceRange },
  { key: "owner_nombre", label: "Owner", section: "senal", weight: 1.3, get: (_l, e) => [e.ownerFirst, e.ownerLast].filter(Boolean).join(" ") },
  { key: "owner_cargo", label: "Cargo owner", section: "senal", weight: 0, get: (_l, e) => e.ownerTitle },
  { key: "owner_confianza", label: "Confianza owner", section: "senal", weight: 0, get: (_l, e) => e.ownerConfidence },
  { key: "intent_score", label: "Intent", section: "senal", weight: 0.7, get: (_l, e) => e.intentScore },
  { key: "intent_prioridad", label: "Prioridad", section: "senal", weight: 0, get: (_l, e) => e.intentPriority },
  { key: "dato_local", label: "Dato local", section: "senal", weight: 2, get: (_l, e) => e.localFact },
  { key: "competidor", label: "Competidor", section: "senal", weight: 0, get: (_l, e) => e.competitorNearby },
  { key: "audit_score", label: "Audit web", section: "senal", weight: 0, get: (_l, e) => e.auditScore },
  { key: "audit_issues", label: "Issues web", section: "senal", weight: 0, get: (_l, e) => e.auditIssues },
  { key: "icebreaker", label: "Icebreaker", section: "enrichment", weight: 0, get: (_l, e) => e.icebreaker },
  { key: "call_script", label: "Call script", section: "enrichment", weight: 0, get: (_l, e) => e.callScript },
  { key: "call_prioridad", label: "Prioridad call", section: "enrichment", weight: 0, get: (_l, e) => e.callPriority },

  // --- Ubicacion ---
  { key: "latitud", label: "Latitud", section: "geo", weight: 0, get: (l) => (l.latitude ?? "").toString() },
  { key: "longitud", label: "Longitud", section: "geo", weight: 0, get: (l) => (l.longitude ?? "").toString() },
  { key: "place_id", label: "Place ID", section: "geo", weight: 0, get: (l) => l.placeId },
  { key: "link_maps", label: "Link Google Maps", section: "geo", weight: 0, get: (l) => l.mapsLink },
  { key: "foto", label: "Foto", section: "geo", weight: 0, get: (l) => l.thumbnail },
];

/** Columnas que van al PDF (peso > 0), en orden. */
export const PDF_FIELDS = EXPORT_FIELDS.filter((f) => (f.weight ?? 0) > 0);

