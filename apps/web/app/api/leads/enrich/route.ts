import { NextResponse } from "next/server";
import { mapWithConcurrency, TtlCache } from "@/lib/concurrency";

// Cache 6h del texto de las webs: el owner/email no cambian tan seguido y
// antes se volvia a bajar cada web en cada request (y en cada export).
const websiteCache = new TtlCache<string>(6 * 60 * 60 * 1000, 500);
import {
  buildCallScript,
  buildIcebreaker,
  buildLocalFact,
  emailTypeOf,
  guessOwnerFromTexts,
  scoreIntent,
  waterfallEmails,
} from "@/lib/enrichment";

type EnrichItem = {
  id?: string;
  name?: string;
  website?: string;
  rating?: number | string;
  reviews?: number | string;
  emails?: string | string[];
  address?: string;
  city?: string;
  area?: string;
  businessType?: string;
  websiteText?: string;
};

function toNum(v: unknown): number | undefined {
  const n = Number(String(v ?? "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : undefined;
}

function domainOf(url: string): string {
  try {
    const withProto = url.startsWith("http") ? url : `https://${url}`;
    return new URL(withProto).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Deduce la zona/barrio desde una direccion.
 * "Av. Corrientes 1234, Palermo, Buenos Aires" -> "Palermo"
 * "123 Main St, Austin, TX 78701" -> "Austin"
 */
function deriveAreaFromAddress(address: string): string {
  const parts = address
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";
  // El penultimo segmento suele ser barrio/localidad, el ultimo la ciudad o estado.
  const candidate = parts.length >= 3 ? parts[parts.length - 2] : parts[0];
  // Descarta el pais (codigo postal o nombre de estado largo)
  if (!candidate || candidate.length < 3 || candidate.length > 28) return "";
  if (/^\d{4,}$/.test(candidate)) return "";
  return candidate;
}

async function fetchWebsiteText(url: string): Promise<string> {
  const cached = websiteCache.get(url);
  if (cached !== undefined) return cached;

  try {
    const target = url.startsWith("http") ? url : `https://${url}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(target, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadExtractor/1.0)" },
    });
    clearTimeout(t);
    if (!res.ok) {
      websiteCache.set(url, "");
      return "";
    }
    const html = await res.text();
    // Extrae texto visible + Bio Owner / Contacto si aparecen en el HTML
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 20000);
    websiteCache.set(url, text);
    return text;
  } catch {
    websiteCache.set(url, "");
    return "";
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const items = Array.isArray(body.items) ? (body.items as EnrichItem[]) : [];
    const areaDefault = String(body.area ?? "");
    const businessTypeDefault = String(body.businessType ?? "negocios locales");
    if (!items.length) return NextResponse.json({ count: 0, items: [] });

    // Competidor cercano: el de mayor reviews en el lote (heurística local sin API paga)
    const sorted = [...items].sort(
      (a, b) => (toNum(b.reviews) ?? 0) - (toNum(a.reviews) ?? 0)
    );
    const topCompetitor = String(sorted[0]?.name ?? "");

    // Pool limitado: antes Promise.all abria hasta 200 conexiones a la vez.
    const enriched = await mapWithConcurrency(
      items.slice(0, 200),
      async (lead) => {
        const name = String(lead.name ?? "Sin nombre");
        const website = String(lead.website ?? "").trim();
        const rawEmails = Array.isArray(lead.emails)
          ? lead.emails
          : String(lead.emails ?? "")
              .split(/[\s,;]+/)
              .filter(Boolean);
        const rating = toNum(lead.rating);
        const reviews = toNum(lead.reviews);
        // Zona: se deduce de la direccion del lead (no hace falta que el usuario la cargue)
        const area =
          String(lead.area ?? "").trim() ||
          deriveAreaFromAddress(String(lead.address ?? "")) ||
          areaDefault ||
          String(lead.city ?? "");
        const btype = String(lead.businessType ?? businessTypeDefault);

        let websiteText = String(lead.websiteText ?? "");
        if (!websiteText && website) websiteText = await fetchWebsiteText(website);

        const owner = guessOwnerFromTexts(
          websiteText ? [{ url: website, text: websiteText }] : []
        );
        const domain = domainOf(website);
        const wf = waterfallEmails({
          scraperEmails: rawEmails,
          websiteText,
          domain,
          ownerFirst: owner.firstName,
          ownerLast: owner.lastName,
        });
        const emailType = wf.email ? emailTypeOf(wf.email) : "unknown";
        const intent = scoreIntent({
          rating,
          reviews,
          hasWebsite: Boolean(website),
          websiteText,
        });
        const competitor =
          name !== topCompetitor && topCompetitor ? topCompetitor : "";
        const localFact = buildLocalFact({
          businessName: name,
          area: area || "la zona",
          rating,
          competitorName: competitor || undefined,
        });
        const icebreaker = buildIcebreaker({
          firstName: owner.firstName || name.split(" ")[0] || "",
          businessType: btype,
          area: area || "la zona",
          localFact,
        });

        return {
          id: lead.id ?? name,
          ownerFirst: owner.firstName,
          ownerLast: owner.lastName,
          ownerFull: owner.fullName,
          ownerTitle: owner.title,
          ownerConfidence: owner.confidence,
          ownerSource: owner.source,
          email: wf.email,
          emailType,
          emailSource: wf.source,
          emailCandidates: wf.candidates,
          intentScore: intent.score,
          intentPriority: intent.priority,
          intentSignals: intent.signals,
          localFact,
          competitorNearby: competitor,
          icebreaker,
          callScript: buildCallScript({ businessName: name, localFact }),
          callPriority: intent.priority,
        };
      },
      8
    );

    return NextResponse.json({ count: enriched.length, items: enriched });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo enriquecer." },
      { status: 500 }
    );
  }
}
