import { NextResponse } from "next/server";
import { mapWithConcurrency, TtlCache } from "@/lib/concurrency";

// Cache 1h del resultado de auditoria por URL: la web no cambia cada minuto
// y antes se re-audtaban las 100 URLs en cada click.
type AuditResult = Awaited<ReturnType<typeof auditOne>>;
const auditCache = new TtlCache<AuditResult>(60 * 60 * 1000, 1000);

type AuditIssue =
  | "no_website"
  | "no_https"
  | "slow_response"
  | "no_viewport_mobile"
  | "missing_title"
  | "missing_description"
  | "thin_content"
  | "fetch_failed";

async function auditOne(rawUrl: string) {
  const url = rawUrl.trim();
  if (!url) {
    return { url, score: 0, issues: ["no_website" as AuditIssue] };
  }
  const target = url.startsWith("http") ? url : `https://${url}`;
  const https = target.startsWith("https://");
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(target, { signal: ctrl.signal, redirect: "follow" });
    const ms = Date.now() - start;
    clearTimeout(t);
    const html = await res.text().catch(() => "");
    const lower = html.toLowerCase();
    const issues: AuditIssue[] = [];
    if (!https) issues.push("no_https");
    if (ms > 3000) issues.push("slow_response");
    if (!/<meta[^>]*viewport/i.test(html)) issues.push("no_viewport_mobile");
    if (!/<title[^>]*>.+<\/title>/i.test(html)) issues.push("missing_title");
    if (!/<meta[^>]*name=["']description["']/i.test(lower)) issues.push("missing_description");
    if (html.length < 8000) issues.push("thin_content");
    let score = 100;
    if (issues.includes("no_https")) score -= 25;
    if (issues.includes("slow_response")) score -= 25;
    if (issues.includes("no_viewport_mobile")) score -= 15;
    if (issues.includes("missing_title")) score -= 10;
    if (issues.includes("missing_description")) score -= 10;
    if (issues.includes("thin_content")) score -= 10;
    return {
      url,
      finalUrl: res.url,
      https,
      responseMs: ms,
      statusCode: res.status,
      hasViewport: !issues.includes("no_viewport_mobile"),
      hasTitle: !issues.includes("missing_title"),
      hasDescription: !issues.includes("missing_description"),
      contentBytes: html.length,
      score: Math.max(0, score),
      issues,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      url,
      score: 10,
      issues: [!https ? "no_https" : "fetch_failed"] as AuditIssue[],
      https,
      checkedAt: new Date().toISOString(),
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawUrls: unknown[] = Array.isArray(body.urls) ? body.urls : [];
    const urls: string[] = rawUrls.map((u) => String(u));
    if (!urls.length) return NextResponse.json({ count: 0, items: [] });

    // Deduplica URLs: la misma web puede repetirse en el lote.
    const unique = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));

    // Pool limitado: antes Promise.all abria 100 conexiones simultaneas.
    const items = await mapWithConcurrency(
      unique.slice(0, 100),
      async (url) => {
        const cached = auditCache.get(url);
        if (cached) return cached;
        const result = await auditOne(url);
        auditCache.set(url, result);
        return result;
      },
      8
    );
    return NextResponse.json({ count: items.length, items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo auditar." },
      { status: 500 }
    );
  }
}
