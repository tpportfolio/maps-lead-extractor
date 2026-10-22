import { NextResponse } from "next/server";
import { mapWithConcurrency, TtlCache } from "@/lib/concurrency";

// Cache 1h de resolucion DNS por dominio. El TTL de DNS real puede ser
// de horas y antes se consultaba en serie en cada request.
const dnsCache = new TtlCache<{ status: string; reason: string; emailType?: string }>(
  60 * 60 * 1000,
  5000
);

type EmailResult = { status: string; reason: string; emailType?: string };

type DohResult =
  | { status: "found" }
  | { status: "not-found" }
  | { status: "error"; reason: string };

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

const DISPOSABLE = new Set([
  "mailinator.com",
  "tempmail.com",
  "10minutemail.com",
  "guerrillamail.com",
  "yopmail.com",
]);

function emailTypeOf(email: string) {
  const prefix = email.split("@")[0]?.toLowerCase() ?? "";
  if (GENERAL_PREFIXES.has(prefix)) return "general";
  return "named";
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidFormat(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveDoh(domain: string, type: "MX" | "A" | "AAAA"): Promise<DohResult> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`;
  try {
    const response = await fetchWithTimeout(url, 6000);
    if (!response.ok) {
      return { status: "error", reason: "http" };
    }
    const data = (await response.json()) as { Status?: number; Answer?: unknown[] };
    if (data.Status === 3) return { status: "not-found" };
    if (Array.isArray(data.Answer) && data.Answer.length > 0) {
      return { status: "found" };
    }
    return { status: "not-found" };
  } catch (error) {
    return { status: "error", reason: "dns-bloqueado" };
  }
}

async function checkDomain(domain: string, email: string): Promise<EmailResult> {
  const lowerDomain = domain.toLowerCase();
  const emailType = emailTypeOf(email);
  if (DISPOSABLE.has(lowerDomain)) {
    return { status: "invalid", reason: "desechable", emailType };
  }
  const mx = await resolveDoh(domain, "MX");
  // V2: sin MX pero con A/AAAA = probable catch-all / web-host sin correo dedicado
  if (mx.status === "not-found") {
    const a = await resolveDoh(domain, "A");
    if (a.status === "found") return { status: "catch-all", reason: "sin-mx-con-web", emailType };
    const aaaa = await resolveDoh(domain, "AAAA");
    if (aaaa.status === "found") return { status: "catch-all", reason: "sin-mx-con-web", emailType };
    return { status: "invalid", reason: "sin-registros", emailType };
  }
  if (mx.status === "error") {
    return { status: "unknown", reason: mx.reason, emailType };
  }

  const a = await resolveDoh(domain, "A");
  if (a.status === "found") return { status: "valid", reason: "mx+a", emailType };
  if (a.status === "error") return { status: "unknown", reason: a.reason, emailType };

  const aaaa = await resolveDoh(domain, "AAAA");
  if (aaaa.status === "found") return { status: "valid", reason: "mx+aaaa", emailType };
  if (aaaa.status === "error") return { status: "unknown", reason: aaaa.reason, emailType };

  // Tiene MX pero sin web pública: válido pero marcar para segundo check catch-all
  return { status: "catch-all", reason: "mx-sin-web", emailType };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const emails = Array.isArray(body.emails) ? body.emails : [];
    const results: Record<string, EmailResult> = {};

    // 1) Normaliza y separa validos de invalidos (sin red).
    const valid: string[] = [];
    for (const raw of emails) {
      const email = normalizeEmail(String(raw ?? ""));
      if (!email) continue;
      if (!isValidFormat(email)) {
        results[email] = { status: "invalid", reason: "formato", emailType: "unknown" };
        continue;
      }
      const domain = email.split("@")[1];
      if (!domain) {
        results[email] = { status: "invalid", reason: "dominio", emailType: "unknown" };
        continue;
      }
      valid.push(email);
    }

    // 2) Un dominio se resuelve una sola vez. Antes el loop era secuencial
    //    (1 consulta DNS por dominio, en serie) y se repetia en cada request.
    const domains = Array.from(new Set(valid.map((e) => e.split("@")[1]!.toLowerCase())));
    const resolved = await mapWithConcurrency(
      domains,
      async (domain) => {
        const memo = dnsCache.get(domain);
        if (memo) return memo;
        const result = await checkDomain(domain, domain);
        dnsCache.set(domain, result);
        return result;
      },
      8
    );
    const byDomain = new Map(domains.map((d, i) => [d, resolved[i]]));

    // 3) Reasigna el resultado a cada email (el emailType es por email).
    for (const email of valid) {
      const domain = email.split("@")[1]!.toLowerCase();
      const cached = byDomain.get(domain) ?? { status: "unknown", reason: "dns-bloqueado" };
      results[email] = { ...cached, emailType: emailTypeOf(email) };
    }

    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo validar emails.",
      },
      { status: 500 }
    );
  }
}
