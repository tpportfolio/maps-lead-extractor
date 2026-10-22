"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState } from "react";
import Window from "@/components/window";
import CategoryPicker from "@/components/category-picker";
import { useI18n } from "@/lib/i18n";
import { EXPORT_FIELDS, PDF_FIELDS, type ExportEnrichment, type ExportLead } from "@/lib/export-schema";
import { ResultRow } from "@/components/result-row";
import { ElapsedClock, SearchProgress } from "@/components/search-status";

const MapAreaSelector = dynamic(() => import("@/components/map-area-selector"), {
  ssr: false,
});
const ResultsMap = dynamic(() => import("@/components/results-map"), {
  ssr: false,
});

type MapCenter = {
  lat: number;
  lng: number;
};

type RawLead = Record<string, unknown>;

type NormalizedLead = {
  id: string;
  name: string;
  address: string;
  category: string;
  phone: string;
  website: string;
  rating: string;
  reviews: string;
  emails: string;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  raw: RawLead;
};

type SearchResponse = {
  count: number;
  items: RawLead[];
  query: string;
  radiusKm?: number;
  center?: MapCenter;
  stats?: {
    total: number;
    rawTotal?: number;
    filteredOut?: number;
    withCoords: number;
    inArea: number;
    outside?: number;
    unknown?: number;
  };
  debug?: {
    sampleKeys?: string[];
    coordinateKeys?: string[];
  } | null;
};

type EmailStatus = "valid" | "invalid" | "unknown" | "none" | "catch-all";

type EmailCheckResponse = {
  results: Record<string, { status: string; reason: string; emailType?: string }>;
};

type EnrichRow = {
  id: string;
  ownerFirst: string;
  ownerLast: string;
  ownerFull: string;
  ownerTitle: string;
  ownerConfidence: string;
  ownerSource: string;
  email: string;
  emailType: string;
  emailSource: string;
  emailCandidates: string[];
  intentScore: number;
  intentPriority: string;
  intentSignals: Record<string, boolean>;
  localFact: string;
  competitorNearby: string;
  icebreaker: string;
  callScript: string;
  callPriority: string;
};

type AuditRow = {
  url: string;
  score: number;
  issues: string[];
  responseMs?: number;
  https?: boolean;
};

// Anchos default de columnas (fr) - el usuario puede ajustarlos a mano por arrastre
const DEFAULT_COLS = [2.2, 0.8, 1, 0.9, 0.7, 0.9];

// Presets de radio de busqueda (km)
const RADIUS_PRESETS = [0.5, 1, 2, 3, 4, 5, 10];

// Tipos oficiales de Google Places (Tabla A). El value enviado es el id de Google;
// el backend lo convierte a query de Maps.
import { ALL_PLACE_TYPES, placeTypeLabel } from "../../../packages/shared/constants/place-types";
import { PLACE_TYPE_LABELS_ES } from "../../../packages/shared/constants/place-types-es";

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

function pickString(value: unknown): string {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  if (value === null || value === undefined) return "";
  return String(value);
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

function normalizeLead(item: RawLead, index: number): NormalizedLead {
  const name =
    pickString(item.title) ||
    pickString(item.name) ||
    pickString(item.businessName) ||
    pickString(item.place_name) ||
    "Sin nombre";

  const address =
    pickString(item.address) ||
    pickString(item.fullAddress) ||
    pickString(item.formattedAddress) ||
    pickString(item.location) ||
    "";

  const category =
    pickString(item.category) ||
    pickString(item.categoryName) ||
    pickString(item.type) ||
    "";

  const phone =
    pickString(item.phone) ||
    pickString(item.phoneNumber) ||
    pickString(item.phone_number) ||
    "";

  const website =
    pickString(item.website) ||
    pickString(item.web_site) ||
    pickString(item.webSite) ||
    pickString(item.website_url) ||
    pickString(item.site) ||
    pickString(item.url) ||
    "";

  // El scraper devuelve review_rating / review_count; se aceptan tambien
  // los nombres alternativos por si cambia el origen.
  const rating = pickString(
    item.review_rating ?? item.rating ?? item.stars ?? item.avgRating
  );
  const reviews = pickString(
    item.review_count ?? item.reviews ?? item.reviewCount ?? item.reviewsCount
  );
  const emails = pickString(item.emails || item.email || item.contactEmails);

  const directLat = Number(item.latitude ?? item.lat ?? item.locationLat);
  const directLng = Number(item.longitude ?? item.longtitude ?? item.lng ?? item.locationLng);
  const geometry = (item.geometry as Record<string, unknown> | undefined)?.location as
    | Record<string, unknown>
    | undefined;
  const geometryCoords = geometry ? parseCoordinates(geometry) : {};
  const gpsCoords = parseCoordinates(
    item.gps ??
      item.coordinates ??
      item.position ??
      item.geo ??
      item.gps_coordinates ??
      item.gpsCoordinates
  );

  let latitude = Number.isFinite(directLat)
    ? directLat
    : geometryCoords.lat ?? gpsCoords.lat;
  let longitude = Number.isFinite(directLng)
    ? directLng
    : geometryCoords.lng ?? gpsCoords.lng;

  if (latitude === undefined || longitude === undefined) {
    const deep = deepFindCoords(item);
    latitude = deep.lat ?? latitude;
    longitude = deep.lng ?? longitude;
  }

  const id =
    pickString(item.placeId) ||
    pickString(item.place_id) ||
    pickString(item.cid) ||
    pickString(item.id) ||
    `${name}-${latitude || "x"}-${longitude || "y"}-${index}`;

  return {
    id,
    name,
    address,
    category,
    phone,
    website,
    rating,
    reviews,
    emails,
    latitude: Number.isFinite(latitude) ? latitude : undefined,
    longitude: Number.isFinite(longitude) ? longitude : undefined,
    raw: item,
  };
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

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function extractEmails(value: string) {
  if (!value) return [] as string[];
  return Array.from(
    new Set(
      value
        .split(/[\s,;]+/)
        .map((entry) => normalizeEmail(entry))
        .filter((entry) => entry.includes("@"))
    )
  );
}


function getLeadEmailStatus(
  lead: NormalizedLead,
  emailStatusMap: Record<string, EmailStatus>
): EmailStatus {
  const emails = extractEmails(lead.emails);
  if (!emails.length) return "none";
  let hasUnknown = false;
  let hasInvalid = false;
  let hasCatchAll = false;
  for (const email of emails) {
    const status = emailStatusMap[email];
    if (status === "valid") return "valid";
    if (status === "catch-all") hasCatchAll = true;
    if (status === "invalid") hasInvalid = true;
    if (!status || status === "unknown") hasUnknown = true;
  }
  if (hasUnknown) return "unknown";
  if (hasCatchAll) return "catch-all";
  if (hasInvalid) return "invalid";
  return "unknown";
}

function matchesCategory(lead: NormalizedLead, filterCategory: string) {
  if (filterCategory === "TODAS") return true;
  // El filtro usa el id de Google (ej. "dental_clinic"); se compara contra
  // la categoria cruda del scraper (mismo id, con guiones bajos).
  const target = normalizeText(filterCategory).replace(/[\s-]+/g, "_");
  const rawCategories = pickString(lead.raw.categories) || pickString(lead.raw.category);
  const haystack = normalizeText(lead.category + " " + rawCategories).replace(/[\s-]+/g, "_");
  if (haystack.includes(target)) return true;
  // Fallback: coincidencia por la etiqueta legible en ambos idiomas
  const label = normalizeText(placeTypeLabel(filterCategory));
  if (haystack.includes(label)) return true;
  const labelEs = normalizeText(PLACE_TYPE_LABELS_ES[filterCategory] ?? "");
  return Boolean(labelEs) && haystack.includes(labelEs);
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


// Serializa valores crudos a texto plano para celdas de export.
function serializeValue(value: unknown, maxLength?: number): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry)).filter(Boolean).join(" | ");
  }
  if (typeof value === "object") {
    try {
      const text = JSON.stringify(value);
      if (maxLength && text.length > maxLength) return `${text.slice(0, maxLength)}...`;
      return text;
    } catch (error) {
      return String(value);
    }
  }
  const text = String(value);
  if (maxLength && text.length > maxLength) return `${text.slice(0, maxLength)}...`;
  return text;
}



type ExportContext = {
  enrichMap: Record<string, EnrichRow>;
  emailCheckStatus: Record<string, EmailStatus>;
  auditMap: Record<string, AuditRow>;
  query: string;
  radiusKm: string;
  count: number;
};

// Normaliza un lead al esquema de export.
function toExportLead(lead: NormalizedLead): ExportLead {
  const raw = lead.raw as Record<string, unknown>;
  return {
    id: lead.id,
    name: lead.name,
    category: lead.category,
    address: lead.address,
    phone: lead.phone,
    website: lead.website,
    emails: lead.emails,
    rating: lead.rating,
    reviews: lead.reviews,
    priceRange: serializeValue(raw.price_range),
    status: serializeValue(raw.status),
    ownerClaimed: serializeValue(raw.owner),
    thumbnail: serializeValue(raw.thumbnail),
    mapsLink: serializeValue(raw.link),
    placeId: serializeValue(raw.place_id),
    latitude: lead.latitude,
    longitude: lead.longitude,
  };
}

function toExportEnrichment(
  lead: NormalizedLead,
  enrichMap: Record<string, EnrichRow>,
  emailCheckStatus: Record<string, EmailStatus>,
  auditMap: Record<string, AuditRow>
): ExportEnrichment {
  const e = enrichMap[lead.id];
  const firstEmail = extractEmails(lead.emails)[0] || e?.email || "";
  return {
    ownerFirst: e?.ownerFirst ?? "",
    ownerLast: e?.ownerLast ?? "",
    ownerTitle: e?.ownerTitle ?? "",
    ownerConfidence: e?.ownerConfidence ?? "not_found",
    emailType: e?.emailType ?? "",
    emailSource: e?.emailSource ?? "",
    emailStatus: firstEmail ? (emailCheckStatus[firstEmail] || "unknown") : "none",
    intentScore: e ? String(e.intentScore) : "",
    intentPriority: e?.intentPriority ?? "",
    localFact: e?.localFact ?? "",
    competitorNearby: e?.competitorNearby ?? "",
    icebreaker: e?.icebreaker ?? "",
    callScript: e?.callScript ?? "",
    callPriority: e?.callPriority ?? "",
    auditScore: auditMap[lead.id] ? String(auditMap[lead.id].score) : "",
    auditIssues: (auditMap[lead.id]?.issues || []).join("|"),
  };
}

function exportKml(leads: NormalizedLead[]) {
  const placemarks = leads
    .filter((lead) => lead.latitude !== undefined && lead.longitude !== undefined)
    .map((lead) => {
      const name = escapeXml(lead.name || "Lead");
      const address = escapeXml(lead.address || "");
      const coords = `${lead.longitude},${lead.latitude},0`;
      return `\n    <Placemark>\n      <name>${name}</name>\n      <description>${address}</description>\n      <Point><coordinates>${coords}</coordinates></Point>\n    </Placemark>`;
    })
    .join("");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>${placemarks}\n  </Document>\n</kml>`;
  downloadFile("leads.kml", kml, "application/vnd.google-earth.kml+xml");
}

function exportCsv(leads: NormalizedLead[], ctx: ExportContext) {
  const headers = EXPORT_FIELDS.map((field) => field.label);
  const rows = leads.map((lead) => {
    const el = toExportLead(lead);
    const en = toExportEnrichment(lead, ctx.enrichMap, ctx.emailCheckStatus, ctx.auditMap);
    return EXPORT_FIELDS.map((field) => field.get(el, en));
  });

  const csv = [headers, ...rows]
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          return `"${text.replace(/"/g, '""')}"`;
        })
        .join(",")
    )
    .join("\n");

  downloadFile("leads.csv", csv, "text/csv;charset=utf-8;");
}

async function exportExcel(leads: NormalizedLead[], ctx: ExportContext) {
  const xlsx = await import("xlsx");
  const worksheet = xlsx.utils.json_to_sheet(
    leads.map((lead) => {
      const el = toExportLead(lead);
      const en = toExportEnrichment(lead, ctx.enrichMap, ctx.emailCheckStatus, ctx.auditMap);
      const row: Record<string, string | number> = {};
      for (const field of EXPORT_FIELDS) {
        row[field.label] = field.get(el, en);
      }
      return row;
    })
  );
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Leads");
  const data = xlsx.write(workbook, { type: "array", bookType: "xlsx" });
  const blob = new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "leads.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

async function exportPdf(
  leads: NormalizedLead[],
  ctx: ExportContext,
  options: { includePhotos: boolean }
) {
  const rows = leads.map((lead) => {
    const el = toExportLead(lead);
    const en = toExportEnrichment(lead, ctx.enrichMap, ctx.emailCheckStatus, ctx.auditMap);
    const cells: Record<string, string> = {};
    for (const field of EXPORT_FIELDS) {
      cells[field.key] = field.get(el, en);
    }
    return { cells, thumbnail: el.thumbnail };
  });

  // pdf-lib (~500KB) se carga solo al exportar PDF: no entra al bundle inicial.
  const { buildLeadsPdf } = await import("@/lib/pdf-export");
  const bytes = await buildLeadsPdf({
    title: "MAPS LEAD EXTRACTOR",
    subtitle: `${ctx.query} · radio ${ctx.radiusKm} km · ${ctx.count} leads · ${new Date().toLocaleString("es-AR")}`,
    fields: PDF_FIELDS,
    rows,
    includePhotos: options.includePhotos,
  });

  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "leads.pdf";
  link.click();
  URL.revokeObjectURL(url);
}

function playCompletionSound() {
  try {
    const audio = new Audio("/notification.mp3");
    audio.volume = 0.6;
    void audio.play();
  } catch (error) {
    // No-op
  }
}

export default function LeadSearchForm() {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("TODAS");
  const [radiusKm, setRadiusKm] = useState("0.5");
  const [customKeyword, setCustomKeyword] = useState("");
  const [depth, setDepth] = useState("5");
  const [includePhotos, setIncludePhotos] = useState(true);
  // -email del scraper: rasca cada web de negocio. Redundante si despues
  // se corre Enriquecer (que ya lo hace con cache y pool limitado).
  const [includeEmails, setIncludeEmails] = useState(false);
  // Proxies: credenciales, no se persisten en disco.
  const [proxies, setProxies] = useState("");
  // Si la corrida anterior quedo a medias, "Buscar" la reanuda. Con esto se fuerza desde cero.
  const [freshSearch, setFreshSearch] = useState(false);
  const [resumed, setResumed] = useState(false);
  // Leads que venian de la corrida anterior (0 si arranco de cero).
  const [previousCount, setPreviousCount] = useState(0);
  const [center, setCenter] = useState<MapCenter | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [filterEmail, setFilterEmail] = useState(false);
  const [filterValidEmail, setFilterValidEmail] = useState(false);
  const [filterInsideRadius, setFilterInsideRadius] = useState(true);
  const [filterCategory, setFilterCategory] = useState("TODAS");
  const [emailCheckStatus, setEmailCheckStatus] = useState<Record<string, EmailStatus>>({});
  const [emailCheckRunning, setEmailCheckRunning] = useState(false);
  // V2 states
  const [minReviews, setMinReviews] = useState("");
  const [maxReviews, setMaxReviews] = useState("");
  const [minRating, setMinRating] = useState("");
  const [onlyWithPhone, setOnlyWithPhone] = useState(false);
  const [onlyWithWebsite, setOnlyWithWebsite] = useState(false);
  const [excludeChains, setExcludeChains] = useState(false);
  const [sortBy, setSortBy] = useState<"score" | "distance" | "reviews">("score");
  const [viewTab, setViewTab] = useState<"resultados" | "calling" | "copy">("resultados");
  const [enrichMap, setEnrichMap] = useState<Record<string, EnrichRow>>({});
  const [enrichRunning, setEnrichRunning] = useState(false);
  const [auditMap, setAuditMap] = useState<Record<string, AuditRow>>({});
  const [auditRunning, setAuditRunning] = useState(false);
  const [contactedIds, setContactedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const saved = window.localStorage.getItem("lead_contacted") ?? window.localStorage.getItem("v2_contacted");
      if (!saved) return new Set<string>();
      const arr = JSON.parse(saved) as unknown;
      if (Array.isArray(arr)) return new Set(arr.map(String));
    } catch {}
    return new Set<string>();
  });
  const [colWidths, setColWidths] = useState<number[] | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = window.localStorage.getItem("lead_colwidths") ?? window.localStorage.getItem("v2_colwidths");
      if (!saved) return null;
      const arr = JSON.parse(saved) as unknown;
      if (Array.isArray(arr) && arr.length === 6 && arr.every((n) => typeof n === "number" && n >= 0.3 && n <= 5)) {
        return arr as number[];
      }
    } catch {}
    return null;
  });
  const colWidthsRef = useRef<number[] | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const boundsLabel = useMemo(() => {
    if (!center) return "No se selecciono centro";
    return `Centro: ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;
  }, [center]);

  const hasResult = Boolean(result);

  const leads = useMemo(() => {
    if (!result?.items) return [] as NormalizedLead[];
    return result.items.map((item, index) => normalizeLead(item, index));
  }, [result]);

  const uniqueLeads = useMemo(() => {
    const map = new Map<string, NormalizedLead>();
    leads.forEach((lead) => {
      if (!map.has(lead.id)) {
        map.set(lead.id, lead);
      }
    });
    return Array.from(map.values());
  }, [leads]);

  const radiusValue = Number(radiusKm) || 0;
  // Tolerancia del 2% del radio: Maps no aplica un circle estricto.
  const radiusTol = radiusValue * 0.02;
  const searchCenter = result?.center ?? center;

  const leadsWithDistance = useMemo(() => {
    if (!searchCenter) return uniqueLeads;
    return uniqueLeads.map((lead) => {
      if (lead.latitude === undefined || lead.longitude === undefined) return lead;
      const distanceKm = haversineKm(searchCenter.lat, searchCenter.lng, lead.latitude, lead.longitude);
      return { ...lead, distanceKm };
    });
  }, [uniqueLeads, searchCenter]);


  const emailCheckPerformed = useMemo(
    () => Object.keys(emailCheckStatus).length > 0,
    [emailCheckStatus]
  );

  const emailSummary = useMemo(() => {
    const summary = { valid: 0, invalid: 0, unknown: 0, catchAll: 0 };
    Object.values(emailCheckStatus).forEach((status) => {
      if (status === "valid") summary.valid += 1;
      else if (status === "invalid") summary.invalid += 1;
      else if (status === "catch-all") summary.catchAll += 1;
      else if (status === "unknown") summary.unknown += 1;
    });
    return summary;
  }, [emailCheckStatus]);

  const filteredLeads = useMemo(() => {
    const base = leadsWithDistance.filter((lead) => {
      if (contactedIds.has(lead.id)) return false;
      if (filterEmail && !lead.emails) return false;
      if (!matchesCategory(lead, filterCategory)) return false;
      if (filterValidEmail) {
        const status = getLeadEmailStatus(lead, emailCheckStatus);
        if (status !== "valid" && status !== "catch-all") return false;
      }
      if (filterInsideRadius && searchCenter && radiusValue) {
        if (lead.distanceKm === undefined) return false;
        if (lead.distanceKm > radiusValue + radiusTol) return false;
      }
      return true;
    });
    // V2 sort: score (enrich) > reviews > distance
    const withSort = [...base].sort((a, b) => {
      if (sortBy === "distance") return (a.distanceKm ?? 999) - (b.distanceKm ?? 999);
      if (sortBy === "reviews") return Number(b.reviews || 0) - Number(a.reviews || 0);
      const sa = enrichMap[a.id]?.intentScore ?? (a.phone ? 55 : 45);
      const sb = enrichMap[b.id]?.intentScore ?? (b.phone ? 55 : 45);
      return sb - sa;
    });
    return withSort;
  }, [
    leadsWithDistance,
    filterEmail,
    filterCategory,
    filterValidEmail,
    filterInsideRadius,
    emailCheckStatus,
    searchCenter,
    radiusValue,
    contactedIds,
    sortBy,
    enrichMap,
    radiusTol,
  ]);


  const mapLeads = useMemo(
    () =>
      filteredLeads.map((lead) => ({
        id: lead.id,
        name: lead.name,
        address: lead.address,
        latitude: lead.latitude,
        longitude: lead.longitude,
      })),
    [filteredLeads]
  );

  const visibleDistanceStats = useMemo(() => {
    if (!searchCenter || !radiusValue) return null;
    let inside = 0;
    let outside = 0;
    let closest = Number.POSITIVE_INFINITY;

    filteredLeads.forEach((lead) => {
      if (lead.distanceKm === undefined) return;
      if (lead.distanceKm <= radiusValue + radiusTol) inside += 1;
      else outside += 1;
      if (lead.distanceKm < closest) closest = lead.distanceKm;
    });

    if (!Number.isFinite(closest)) closest = 0;

    return { inside, outside, closest };
  }, [filteredLeads, searchCenter, radiusValue, radiusTol]);
  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  // Sube o baja el radio en pasos de 0.5 km, con minimo 0.5 y maximo 50.
  const stepRadius = (delta: number) => {
    const current = Number(radiusKm);
    const base = Number.isFinite(current) && current > 0 ? current : 0.5;
    const next = Math.min(50, Math.max(0.5, Math.round((base + delta) * 2) / 2));
    setRadiusKm(String(next));
  };

  // Atajos del radio: flechas arriba/abajo saltan al preset siguiente/anterior,
  // teclas 1-7 fijan un preset directo.
  const handleRadiusKey = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      ev.preventDefault();
      const current = Number(radiusKm) || 0;
      const idx = RADIUS_PRESETS.findIndex((p) => Math.abs(p - current) < 0.001);
      const base = idx === -1 ? -1 : idx;
      const next = ev.key === "ArrowUp" ? base + 1 : base - 1;
      if (next < 0) {
        setRadiusKm(String(RADIUS_PRESETS[0]));
        return;
      }
      if (next >= RADIUS_PRESETS.length) {
        setRadiusKm(String(RADIUS_PRESETS[RADIUS_PRESETS.length - 1]));
        return;
      }
      setRadiusKm(String(RADIUS_PRESETS[next]));
      return;
    }
    if (/^[1-7]$/.test(ev.key)) {
      ev.preventDefault();
      setRadiusKm(String(RADIUS_PRESETS[Number(ev.key) - 1]));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    if (!center) {
      setLoading(false);
      setError("Selecciona un centro en el mapa antes de buscar.");
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/leads/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          customKeyword: customKeyword.trim(),
          depth: Number(depth) || 5,
          lang,
          includeEmails,
          proxies: proxies.trim(),
          fresh: freshSearch,
          radiusKm: Number(radiusKm),
          center,
          strictRadius: filterInsideRadius,
          minReviews: minReviews ? Number(minReviews) : undefined,
          maxReviews: maxReviews ? Number(maxReviews) : undefined,
          minRating: minRating ? Number(minRating) : undefined,
          onlyWithPhone,
          onlyWithWebsite,
          excludeChains,
          suppressedKeys: Array.from(contactedIds),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "No se pudo ejecutar la busqueda.");
      }

      const data = (await response.json()) as SearchResponse;
      setResult(data);
      setResumed(Boolean((data as { resumed?: boolean }).resumed));
      setPreviousCount(Number((data as { previousCount?: number }).previousCount ?? 0));
      setFreshSearch(false);
      setEnrichMap({});
      setAuditMap({});
      playCompletionSound();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error inesperado.";
      // Al cancelar, el fetch se aborta y el error es un AbortError:
      // no contiene "cancel", asi que hay que detectarlo aparte.
      const isAbort =
        (err as { name?: string } | null)?.name === "AbortError" ||
        message.includes("canceled") ||
        message.includes("cancel") ||
        message.includes("aborted");
      if (isAbort) {
        setError(t("form.cancel.done"));
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  const runEmailCheck = async () => {
    if (!uniqueLeads.length) {
      setError("No hay leads para validar.");
      return;
    }
    const emails = Array.from(
      new Set(uniqueLeads.flatMap((lead) => extractEmails(lead.emails)))
    );
    if (!emails.length) {
      setError("No hay emails para validar.");
      return;
    }
    setEmailCheckRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/leads/email-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "No se pudo validar emails.");
      }
      const data = (await response.json()) as EmailCheckResponse;
      const nextStatus: Record<string, EmailStatus> = {};
      Object.entries(data.results || {}).forEach(([email, result]) => {
        if (result.status === "valid") nextStatus[email] = "valid";
        else if (result.status === "invalid") nextStatus[email] = "invalid";
        else if (result.status === "catch-all") nextStatus[email] = "catch-all";
        else nextStatus[email] = "unknown";
      });
      setEmailCheckStatus(nextStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al validar emails.");
    } finally {
      setEmailCheckRunning(false);
    }
  };

  const runEnrich = async () => {
    if (!filteredLeads.length) {
      setError("No hay leads para enriquecer.");
      return;
    }
    setEnrichRunning(true);
    setError(null);
    try {
      const payload = filteredLeads.slice(0, 100).map((lead) => ({
        id: lead.id,
        name: lead.name,
        website: lead.website,
        rating: lead.rating,
        reviews: lead.reviews,
        emails: lead.emails,
        address: lead.address,
        businessType: query,
      }));
      const response = await fetch("/api/leads/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload, businessType: query }),
      });
      if (!response.ok) throw new Error("No se pudo enriquecer.");
      const data = (await response.json()) as { items: EnrichRow[] };
      const map: Record<string, EnrichRow> = {};
      (data.items || []).forEach((row) => {
        map[row.id] = row;
      });
      setEnrichMap((prev) => ({ ...prev, ...map }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enriquecer.");
    } finally {
      setEnrichRunning(false);
    }
  };

  const runAudit = async () => {
    if (!filteredLeads.length) {
      setError("No hay leads para auditar.");
      return;
    }
    setAuditRunning(true);
    try {
      const urls = filteredLeads.slice(0, 60).map((l) => l.website).filter(Boolean);
      const response = await fetch("/api/leads/audit-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      if (!response.ok) throw new Error("No se pudo auditar.");
      const data = (await response.json()) as { items: AuditRow[] };
      const map: Record<string, AuditRow> = {};
      // match por url -> lead id
      filteredLeads.forEach((lead) => {
        const found = (data.items || []).find(
          (a) => a.url === lead.website || a.url === `https://${lead.website}` || lead.website.includes(a.url.replace("https://", "").replace("http://", ""))
        );
        if (found) map[lead.id] = found;
      });
      setAuditMap((prev) => ({ ...prev, ...map }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error en auditoría.");
    } finally {
      setAuditRunning(false);
    }
  };

  const markContacted = (id: string) => {
    setContactedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem("lead_contacted", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const colsTemplate = (colWidths ?? DEFAULT_COLS)
    .map((w, i, a) => (i === a.length - 1 ? `minmax(104px,${w}fr)` : `minmax(0,${w}fr)`))
    .join(" ");

  const handleColResize = (ev: React.MouseEvent<HTMLSpanElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    const idx = Number(ev.currentTarget.dataset.colIndex ?? 0);
    const base = [...(colWidths ?? DEFAULT_COLS)];
    const startX = ev.clientX;
    const listEl = document.getElementById("result-list");
    const totalPx = listEl?.clientWidth || 1100;
    const totalFr = base.reduce((a, b) => a + b, 0);

    const onMove = (me: MouseEvent) => {
      const dFr = ((me.clientX - startX) / totalPx) * totalFr;
      const next = [...base];
      next[idx] = Math.min(4, Math.max(0.35, +(base[idx] + dFr).toFixed(3)));
      next[idx + 1] = Math.min(4, Math.max(0.35, +(base[idx + 1] - dFr).toFixed(3)));
      colWidthsRef.current = next;
      setColWidths(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      try {
        if (colWidthsRef.current) window.localStorage.setItem("lead_colwidths", JSON.stringify(colWidthsRef.current));
      } catch {}
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resetColWidths = () => {
    colWidthsRef.current = null;
    setColWidths(null);
    try {
      window.localStorage.removeItem("lead_colwidths");
    } catch {}
  };

  const exportCtx: ExportContext = {
    enrichMap,
    emailCheckStatus,
    auditMap,
    query,
    radiusKm,
    count: filteredLeads.length,
  };

  const exportCrmCsv = (leads: NormalizedLead[]) => {
    const headers = [
      "business_name", "address", "category", "phone", "website",
      "owner_first", "owner_last", "owner_title", "owner_confidence",
      "email", "email_type", "email_source", "email_status",
      "rating", "reviews", "intent_score", "intent_priority",
      "local_fact", "competitor", "icebreaker", "call_script", "call_priority",
      "audit_score", "audit_issues", "maps_link", "lat", "lng",
    ];
    const rows = leads.map((lead) => {
      const e = enrichMap[lead.id];
      const firstEmail = extractEmails(lead.emails)[0] || e?.email || "";
      const status = firstEmail ? (emailCheckStatus[firstEmail] || "unknown") : "none";
      const audit = auditMap[lead.id];
      const mapsLink = String((lead.raw as Record<string, unknown>).link ?? (lead.raw as Record<string, unknown>).reviews_link ?? "");
      return [
        lead.name, lead.address, lead.category, lead.phone, lead.website,
        e?.ownerFirst ?? "", e?.ownerLast ?? "", e?.ownerTitle ?? "", e?.ownerConfidence ?? "not_found",
        e?.email || firstEmail, e?.emailType ?? "", e?.emailSource ?? "", status,
        lead.rating, lead.reviews, String(e?.intentScore ?? ""), e?.intentPriority ?? "",
        e?.localFact ?? "", e?.competitorNearby ?? "", (e?.icebreaker ?? "").replace(/\n/g, " "),
        (e?.callScript ?? "").replace(/\n/g, " "), e?.callPriority ?? "",
        audit ? String(audit.score) : "", (audit?.issues || []).join("|"), mapsLink,
        String(lead.latitude ?? ""), String(lead.longitude ?? ""),
      ];
    });
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    downloadFile("leads_crm.csv", csv, "text/csv;charset=utf-8;");
  };

  return (
    <Window
      title="MAPS LEAD EXTRACTOR"
      status={
        <>
          <span>
            {loading
              ? "SCRAPE EN CURSO"
              : hasResult
                ? `${filteredLeads.length} LEADS VISIBLES / ${uniqueLeads.length} TOTALES`
                : "IDLE - SIN RESULTADOS"}
          </span>
          <span>
            {Object.keys(enrichMap).length} ENRIQUECIDOS - {contactedIds.size} CONTACTADOS - {emailSummary.valid} EMAILS VALIDOS
          </span>
          {resumed ? (
            <span className="app-status-flag">
              {t("search.resumed")}
              {previousCount > 0 ? ` · ${previousCount} ${t("search.resumed.previous")}` : ""}
            </span>
          ) : null}
        </>
      }
    >
    <div className="flex flex-col">
      <form id="lead-search-form" onSubmit={handleSubmit} className="vw-section">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
          {/* 1 - Categoria / nicho */}
          <div className="p-6 border-b lg:border-b-0 lg:border-r border-[color:var(--outline-variant)]">
            <label className="block text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted)] mb-2">
              {t("form.category")}
            </label>
            <CategoryPicker value={query} onChange={setQuery} />
            <div className="text-[10px] text-[color:var(--soft)] mt-1">
              {ALL_PLACE_TYPES.length} tipos oficiales de Google Maps.
            </div>
            <label className="block text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted)] mt-4 mb-2">
              {t("form.keyword")}
            </label>
            <input
              className="input-field"
              placeholder="Ej. carniceria, avicola, lavanderia"
              value={customKeyword}
              onChange={(e) => setCustomKeyword(e.target.value)}
            />
            <div className="text-[10px] text-[color:var(--soft)] mt-1">
              {t("form.keyword.hint")}
            </div>
          </div>

          {/* 2 - Tiempo de busqueda + boton de buscar centrado */}
          <div className="p-6 border-b lg:border-b-0 lg:border-r border-[color:var(--outline-variant)] flex flex-col">
            <label className="block text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted)] mb-2">
              {t("form.time")}
            </label>
            <ElapsedClock running={loading} />
            <div className="mt-auto pt-8 flex justify-center">
              {loading ? (
                <button
                  type="button"
                  className="button-ghost button-cancel w-full max-w-[240px] h-[48px] text-[11px]"
                  onClick={handleCancel}
                >
                  {t("form.cancel")}
                </button>
              ) : (
                <button
                  type="submit"
                  className="button-primary w-full max-w-[240px] h-[48px] text-[11px]"
                >
                  {t("form.search")}
                </button>
              )}
            </div>
          </div>

          {/* 3 - Radio (km) */}
          <div className="p-6">
            <label className="block text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted)] mb-2">
              {t("form.radius")}
            </label>
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                className="button-ghost radio-step"
                onClick={() => stepRadius(-0.5)}
                aria-label="Reducir radio 0.5 km"
                title="Reducir 0.5 km"
              >
                &minus;
              </button>
              <input
                className="input-field text-center"
                value={radiusKm}
                onChange={(event) => setRadiusKm(event.target.value)}
                onKeyDown={handleRadiusKey}
                inputMode="decimal"
                aria-label="Radio de busqueda en kilometros"
              />
              <button
                type="button"
                className="button-ghost radio-step"
                onClick={() => stepRadius(0.5)}
                aria-label="Aumentar radio 0.5 km"
                title="Aumentar 0.5 km"
              >
                +
              </button>
            </div>
            <div className="radio-presets">
              {RADIUS_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`radio-chip ${Number(radiusKm) === preset ? "is-active" : ""}`}
                  onClick={() => setRadiusKm(String(preset))}
                  title={`Fijar radio en ${preset} km`}
                >
                  {preset}km
                </button>
              ))}
            </div>
            <div className="radio-hint">{t("form.radius.hint")}</div>
            <label className="flex items-center gap-2 mt-4 text-[10px] uppercase tracking-widest text-[color:var(--muted)]"><input type="checkbox" checked={onlyWithPhone} onChange={(e) => setOnlyWithPhone(e.target.checked)} /> {t("form.withPhone")}</label>
            <label className="flex items-center gap-2 mt-1 text-[10px] uppercase tracking-widest text-[color:var(--muted)]"><input type="checkbox" checked={onlyWithWebsite} onChange={(e) => setOnlyWithWebsite(e.target.checked)} /> {t("form.withWeb")}</label>
            <label className="flex items-center gap-2 mt-1 text-[10px] uppercase tracking-widest text-[color:var(--muted)]"><input type="checkbox" checked={excludeChains} onChange={(e) => setExcludeChains(e.target.checked)} /> {t("form.excludeChains")}</label>
            <label className="flex items-start gap-2 mt-2 text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
              <input type="checkbox" checked={includeEmails} onChange={(e) => setIncludeEmails(e.target.checked)} />
              <span>
                {t("form.scrapeEmails")}
                <span className="block normal-case tracking-normal text-[color:var(--soft)] mt-0.5">
                  {t("form.scrapeEmails.hint")}
                </span>
              </span>
            </label>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-[color:var(--outline-variant)]">
          <label className="block text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted)] mb-2">
            {t("form.proxies")}
          </label>
          <input
            className="input-field"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="http://user:pass@host:port, socks5://host:port"
            value={proxies}
            onChange={(e) => setProxies(e.target.value)}
          />
          <div className="text-[10px] text-[color:var(--soft)] mt-1">
            {t("form.proxies.hint")}
          </div>
          <label className="flex items-center gap-2 mt-3 text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
            <input
              type="checkbox"
              checked={freshSearch}
              onChange={(e) => setFreshSearch(e.target.checked)}
            />
            {t("form.fresh")}
            <span className="block normal-case tracking-normal text-[color:var(--soft)]">
              {t("form.fresh.hint")}
            </span>
          </label>
        </div>
        <SearchProgress running={loading} />
      </form>

      <section id="mapa" className="vw-section">
        <div className="vw-section-title">Seleccion de area</div>
        <MapAreaSelector radiusKm={Number(radiusKm) || 0} onCenterChange={setCenter} />
        <div className="mt-3 text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted)]">
          Area: {boundsLabel}
        </div>
      </section>

      <section id="filtros" className="vw-section">
        <div className="vw-section-title">{t("filters.title")}</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 items-end">
          <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted)]">
            {t("filters.category")}
            <CategoryPicker value={filterCategory} onChange={setFilterCategory} />
          </label>
          <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
            {t("filters.insideRadius")}
            <div className="flex items-center gap-3 h-[40px]">
              <input
                type="checkbox"
                checked={filterInsideRadius}
                onChange={(event) => setFilterInsideRadius(event.target.checked)}
              />
              <span className="text-[11px] text-[color:var(--muted)]">Si</span>
            </div>
          </label>
          <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
            {t("filters.withEmail")}
            <div className="flex items-center gap-3 h-[40px]">
              <input
                type="checkbox"
                checked={filterEmail}
                onChange={(event) => setFilterEmail(event.target.checked)}
              />
              <span className="text-[11px] text-[color:var(--muted)]">Si</span>
            </div>
          </label>
          <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
            {t("filters.validEmail")}
            <div className="flex items-center gap-3 h-[40px]">
              <input
                type="checkbox"
                checked={filterValidEmail}
                onChange={(event) => setFilterValidEmail(event.target.checked)}
              />
              <span className="text-[11px] text-[color:var(--muted)]">Si</span>
            </div>
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
              {t("filters.emailCheck")}
            </span>
            <button
              type="button"
              className="button-ghost px-4 py-3 text-[10px]"
              onClick={runEmailCheck}
              disabled={emailCheckRunning || !uniqueLeads.length}
            >
              {emailCheckRunning ? "VALIDANDO..." : t("filters.runCheck")}
            </button>
            {emailCheckPerformed ? (
              <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
                Validos {emailSummary.valid} - Catch-all {emailSummary.catchAll} - Invalidos {emailSummary.invalid} - Inciertos {emailSummary.unknown}
              </div>
            ) : null}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end mt-6">
          <label className="flex flex-col gap-2 text-[11px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
            {t("filters.order")}
            <select className="input-field" value={sortBy} onChange={(e) => setSortBy(e.target.value as "score" | "distance" | "reviews")}>
              <option value="score">{t("filters.order.score")}</option>
              <option value="reviews">{t("filters.order.reviews")}</option>
              <option value="distance">{t("filters.order.distance")}</option>
            </select>
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted)]">{t("filters.enrich")}</span>
            <button type="button" className="button-ghost px-4 py-3 text-[10px]" onClick={runEnrich} disabled={enrichRunning || !filteredLeads.length}>
              {enrichRunning ? t("filters.enrichRunning") : `${t("filters.enrichRun")} ${Math.min(filteredLeads.length, 100)}`}
            </button>
            {Object.keys(enrichMap).length > 0 ? <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">{Object.keys(enrichMap).length} enriquecidos</div> : null}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">{t("filters.audit")}</span>
            <button type="button" className="button-ghost px-4 py-3 text-[10px]" onClick={runAudit} disabled={auditRunning || !filteredLeads.length}>
              {auditRunning ? t("filters.auditRunning") : t("filters.auditRun")}
            </button>
            {Object.keys(auditMap).length > 0 ? <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">{Object.keys(auditMap).length} auditados</div> : null}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">{t("filters.view")}</span>
            <div className="flex gap-2">
              {(["resultados", "calling", "copy"] as const).map((view) => (
                <button key={view} type="button" onClick={() => setViewTab(view)} className={`button-ghost text-[10px] ${viewTab === view ? "active" : ""}`}>{t(`filters.view.${view}`)}</button>
              ))}
            </div>
            <div className="text-[11px] text-[color:var(--muted)]">{contactedIds.size} {t("filters.contacted")}</div>
          </div>
        </div>
        <div className="mt-6 pt-6 border-t border-[color:var(--outline-variant)] grid grid-cols-1 md:grid-cols-4 gap-6">
          <label className="flex flex-col gap-2 text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
            Min reviews
            <input className="input-field" value={minReviews} onChange={(e) => setMinReviews(e.target.value)} inputMode="numeric" placeholder="10" />
          </label>
          <label className="flex flex-col gap-2 text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
            Max reviews
            <input className="input-field" value={maxReviews} onChange={(e) => setMaxReviews(e.target.value)} inputMode="numeric" placeholder="500" />
          </label>
          <label className="flex flex-col gap-2 text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
            Min rating
            <input className="input-field" value={minRating} onChange={(e) => setMinRating(e.target.value)} inputMode="numeric" placeholder="3.5" />
          </label>
          <label className="flex flex-col gap-2 text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
            Profundidad de scroll
            <input className="input-field" value={depth} onChange={(e) => setDepth(e.target.value)} inputMode="numeric" placeholder="5" />
            <span className="block text-[10px] normal-case tracking-normal text-[color:var(--soft)]">
              Cuanto mas alto, mas resultados por celda (10 = maximo, mas lento).
            </span>
          </label>
        </div>
      </section>

      {error ? (
        <div className="vw-section">
          <div className="badge-error">{error}</div>
        </div>
      ) : null}

      {hasResult ? (
        <>
          <section id="resultados" className="vw-section">
            <div className="panel-header">
              <h2>{t("results.title")} - {viewTab}</h2>
              <div className="flex items-center gap-2">
                <span>{filteredLeads.length} visibles - {uniqueLeads.length} totales - {Object.keys(enrichMap).length} enriquecidos</span>
                {colWidths ? (
                  <button type="button" className="button-ghost px-2 py-1 text-[9px]" onClick={resetColWidths} title="Volver a los anchos por defecto">
                    RESTABLECER ANCHOS
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {result?.stats ? (
                <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
                  Total: {String((result.stats as Record<string, unknown>).rawTotal ?? result.stats.total)} - filtrados: {result.stats.total} - Con coords: {result.stats.withCoords} - Dentro: {String(result.stats.inArea ?? "-")} - Fuera: {String(result.stats.outside ?? "-")}
                </div>
              ) : null}
              {searchCenter ? (
                <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
                  Centro: {searchCenter.lat.toFixed(6)}, {searchCenter.lng.toFixed(6)} - Radio: {radiusKm} km
                </div>
              ) : null}
              {visibleDistanceStats ? (
                <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
                  Visibles dentro: {visibleDistanceStats.inside} - Fuera: {visibleDistanceStats.outside} - Más cercano: {visibleDistanceStats.closest.toFixed(2)} km
                </div>
              ) : null}
              {filteredLeads.length === 0 && uniqueLeads.length > 0 ? (
                <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
                  Sin visibles (supresión/filtros). Revisa filtros o limpia contactados.
                </div>
              ) : null}
              {Object.keys(enrichMap).length === 0 && filteredLeads.length > 0 ? (
                <div className="text-[10px] uppercase tracking-[0.2em] text-[color:var(--muted)]">
                  Tip curso: corre ENRIQUECER para owner + intent + local fact antes de exportar.
                </div>
              ) : null}
            </div>
            {viewTab === "calling" ? (
              <div className="px-6 pb-6 flex flex-col gap-3">
                {filteredLeads.slice(0, 30).map((lead) => {
                  const e = enrichMap[lead.id];
                  return (
                    <div key={lead.id} className="border p-3 flex flex-col gap-1">
                      <div className="text-[12px] font-semibold">{lead.name} - {lead.phone || "sin teléfono"} - score {e?.intentScore ?? "-"}</div>
                      <div className="text-[11px] text-[color:var(--muted)]">{e?.callScript || `Llamar por ${lead.name}. Abrir con dato del listing y pedir horario.`}</div>
                      <div className="flex gap-2">
                        <button type="button" className="button-ghost px-3 py-2 text-[10px]" onClick={() => markContacted(lead.id)}>{t("status.markContacted")}</button>
                        {lead.phone ? <a className="button-ghost px-3 py-2 text-[10px]" href={`tel:${lead.phone}`}>{t("calling.call")}</a> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : viewTab === "copy" ? (
              <div className="px-6 pb-6 flex flex-col gap-3">
                {filteredLeads.slice(0, 30).map((lead) => {
                  const e = enrichMap[lead.id];
                  return (
                    <div key={lead.id} className="border p-3 flex flex-col gap-1">
                      <div className="text-[12px] font-semibold">{lead.name}</div>
                      <div className="text-[11px]">{e?.icebreaker || `${lead.name}, vi movimiento en la zona. Te mando comparación de ranking?`}</div>
                      <div className="text-[10px] text-[color:var(--muted)]">Local fact: {e?.localFact || "-"} - Competidor: {e?.competitorNearby || "-"}</div>
                      <div className="flex gap-2">
                        <button type="button" className="button-ghost px-3 py-2 text-[10px]" onClick={() => { try { navigator.clipboard.writeText(e?.icebreaker || ""); } catch {} }}>{t("copy.copy")}</button>
                        <button type="button" className="button-ghost px-3 py-2 text-[10px]" onClick={() => markContacted(lead.id)}>{t("status.markContacted")}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
            <div className="result-list" id="result-list" style={colWidths ? ({ "--cols": colsTemplate } as React.CSSProperties) : undefined}>
              <div className="result-header">
                <span>{t("results.col.business")}<span className="col-handle" data-col-index="0" onMouseDown={handleColResize} title="Arrastrar para ajustar ancho" /></span>
                <span>{t("results.col.contact")}<span className="col-handle" data-col-index="1" onMouseDown={handleColResize} title="Arrastrar para ajustar ancho" /></span>
                <span>{t("results.col.website")}<span className="col-handle" data-col-index="2" onMouseDown={handleColResize} title="Arrastrar para ajustar ancho" /></span>
                <span>{t("results.col.owner")}<span className="col-handle" data-col-index="3" onMouseDown={handleColResize} title="Arrastrar para ajustar ancho" /></span>
                <span>{t("results.col.localFact")}<span className="col-handle" data-col-index="4" onMouseDown={handleColResize} title="Arrastrar para ajustar ancho" /></span>
                <span className="text-right">{t("results.col.status")}</span>
              </div>
              {filteredLeads.map((lead, index) => (
                <ResultRow
                  key={`${lead.id}-${index}`}
                  lead={lead}
                  enrich={enrichMap[lead.id]}
                  audit={auditMap[lead.id]}
                  emailStatus={getLeadEmailStatus(lead, emailCheckStatus)}
                  emailCheckPerformed={emailCheckPerformed}
                  index={index}
                  onContacted={markContacted}
                />
              ))}
            </div>
            )}
          </section>

          <section id="mapa-resultados" className="vw-section">
            <div className="vw-section-title">{t("map.title")}</div>
            <ResultsMap
              leads={mapLeads}
              center={center}
              radiusKm={Number(radiusKm) || 0}
            />
          </section>

          <section id="exportar" className="vw-section">
            <div className="vw-section-title">{t("export.title")}</div>
            <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="button-primary"
              disabled={!filteredLeads.length}
              onClick={() => exportCrmCsv(filteredLeads)}
            >
              {t("export.crm")}
            </button>
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
              <input
                type="checkbox"
                checked={includePhotos}
                onChange={(e) => setIncludePhotos(e.target.checked)}
              />
              Incluir fotos en el PDF
            </label>
            <button
              type="button"
              className="button-ghost"
              disabled={!filteredLeads.length}
              onClick={() => exportCsv(filteredLeads, exportCtx)}
            >
              {t("export.csv")}
            </button>
            <button
              type="button"
              className="button-ghost"
              disabled={!filteredLeads.length}
              onClick={() => exportExcel(filteredLeads, exportCtx)}
            >
              {t("export.excel")}
            </button>
            <button
              type="button"
              className="button-ghost"
              disabled={!filteredLeads.length}
              onClick={() => exportPdf(filteredLeads, exportCtx, { includePhotos })}
            >
              {t("export.pdf")}
            </button>
            <button
              type="button"
              className="button-ghost"
              disabled={!filteredLeads.length}
              onClick={() => exportKml(filteredLeads)}
            >
              {t("export.kml")}
            </button>
            </div>
          </section>

          <section id="log" className="vw-section">
            <div className="vw-section-title">{t("log.title")}</div>
            {result?.debug ? (
              <div className="text-[11px] text-[color:var(--muted)]">
                Debug: claves {result.debug.sampleKeys?.join(", ") || "-"} - posibles coords {result.debug.coordinateKeys?.join(", ") || "-"}
              </div>
            ) : (
              <div className="text-[11px] text-[color:var(--muted)]">
                Sin datos de debug.
              </div>
            )}
          </section>
        </>
      ) : loading ? (
        <section className="vw-section grid gap-3" aria-busy="true" aria-label="Cargando resultados">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton">
              <div className="text-[11px] uppercase tracking-[0.1em] text-[color:var(--muted)]">
                {t("loading.searching")} <ElapsedClock running={loading} />
              </div>
            </div>
          ))}
        </section>
      ) : (
        <section className="vw-section">
          <div className="empty-state">
            <strong>{t("empty.title")}</strong>
            <p>{t("empty.body")}</p>
          </div>
        </section>
      )}
    </div>
    </Window>
  );
}

































