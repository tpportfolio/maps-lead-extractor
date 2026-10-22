"use client";

import { memo } from "react";
import { useI18n } from "@/lib/i18n";

export type LeadEmailStatus = "valid" | "invalid" | "unknown" | "none" | "catch-all";

export type RowLead = {
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
  raw: Record<string, unknown>;
};

export type RowEnrich = {
  ownerFull: string;
  ownerTitle: string;
  ownerConfidence: string;
  ownerSource: string;
  email: string;
  emailType: string;
  emailSource: string;
  intentScore: number;
  intentPriority: string;
  intentSignals: Record<string, boolean>;
  localFact: string;
  icebreaker: string;
  callScript: string;
};

export type RowAudit = {
  score: number;
  issues: string[];
};

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry)).filter(Boolean).join(" | ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function getMapsWebsite(lead: RowLead) {
  const raw = (lead.website || "").trim();
  if (!raw) return { href: "", display: "", has: false };
  const first = raw.split(/[\s,;]+/)[0].trim();
  if (!first || first === "-") return { href: "", display: "", has: false };
  const href = /^https?:\/\//i.test(first) ? first : `https://${first}`;
  let display = first.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  if (display.length > 28) display = `${display.slice(0, 26)}…`;
  return { href, display, has: true };
}

type ResultRowProps = {
  lead: RowLead;
  enrich?: RowEnrich;
  audit?: RowAudit;
  emailStatus: LeadEmailStatus;
  emailCheckPerformed: boolean;
  index: number;
  onContacted: (id: string) => void;
};

/**
 * Fila de resultados memoizada: antes cada cambio de estado del formulario
 * re-renderizaba las N filas completas (con su subarbol <details>).
 * Con memo, solo re-renderiza la fila cuya data cambio.
 */
function ResultRowInner({
  lead,
  enrich,
  audit,
  emailStatus,
  emailCheckPerformed,
  index,
  onContacted,
}: ResultRowProps) {
  const { t } = useI18n();
  const raw = lead.raw;
  const openHours = serializeValue(raw.open_hours ?? raw.openHours);
  const safeValue = (value: string) => (value ? value : "-");
  const mapsWeb = getMapsWebsite(lead);
  const ownerName = (enrich?.ownerFull || "").trim();
  const ownerTitle = (enrich?.ownerTitle || "").trim();
  const contactEmail = (enrich?.email || lead.emails || "").trim();
  const enriched = Boolean(enrich);

  return (
    <details className="result-item" style={{ ["--index" as string]: index % 12 }}>
      <summary className="result-summary">
        <span className="result-name">
          <span className="result-title">
            {lead.name} {enrich ? `· ${enrich.intentScore}` : ""} {audit ? `· web ${audit.score}` : ""}
          </span>
          <span className="result-subtitle">
            {lead.address} - {lead.rating || "-"}* ({lead.reviews || "0"})
          </span>
        </span>
        <span className="result-cell result-contact">{lead.phone || "-"}</span>
        <span className="result-cell result-website">
          {mapsWeb.has ? (
            <a
              href={mapsWeb.href}
              target="_blank"
              rel="noopener noreferrer"
              title={lead.website}
              className="website-link"
              onClick={(ev) => ev.stopPropagation()}
            >
              <span className="website-dot" aria-hidden="true" />
              <span className="website-text">{mapsWeb.display}</span>
              <svg className="website-ext" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M7 1h4v4M11 1L5.5 6.5M9 7v4H1V3h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
          ) : (
            <span className="website-empty">{t("results.noWebsite")}</span>
          )}
        </span>
        <span className="result-cell result-owner">
          {ownerName ? (
            <span className="owner-name">
              {ownerName}
              {ownerTitle ? <span className="owner-title"> - {ownerTitle}</span> : null}
            </span>
          ) : (
            <span
              className="owner-missing"
              title={
                enriched
                  ? "Buscamos al dueno en la web del negocio y no lo encontramos"
                  : "Corre Enriquecer para detectar al dueno"
              }
            >
              {enriched ? t("results.ownerMissing") : " - "}
            </span>
          )}
          <br />
          {contactEmail ? (
            <span className="owner-email">{contactEmail}</span>
          ) : (
            <span className="owner-missing">Sin email</span>
          )}
        </span>
        <span className="result-cell result-local" title={enrich?.localFact || undefined}>
          {enrich?.localFact || "-"}
        </span>
        <span className="result-status">
          {!lead.emails && !enrich?.email ? (
            <span className="badge-error">{t("status.noEmail")}</span>
          ) : !emailCheckPerformed ? (
            <span className="badge-neutral">{t("status.noValid")}</span>
          ) : emailStatus === "valid" ? (
            <span className="badge-ok">{t("status.valid")}</span>
          ) : emailStatus === "catch-all" ? (
            <span className="badge-neutral">{t("status.catchAll")}</span>
          ) : emailStatus === "invalid" ? (
            <span className="badge-error">{t("status.invalid")}</span>
          ) : (
            <span className="badge-neutral">{t("status.uncertain")}</span>
          )}
          <button
            type="button"
            className="button-ghost px-2 py-1 text-[9px] mt-1"
            onClick={(ev) => {
              ev.preventDefault();
              onContacted(lead.id);
            }}
          >
            CONTACTADO
          </button>
        </span>
      </summary>
      <div className="result-details">
        <div className="detail-row">
          <span className="detail-k">Website Maps</span>
          <span className="detail-v">
            {mapsWeb.has ? (
              <>
                <a href={mapsWeb.href} target="_blank" rel="noopener noreferrer" className="website-link">
                  {mapsWeb.display}
                </a>
                <span className="detail-note"> - {t("results.declaredInMaps")}</span>
              </>
            ) : (
              t("results.noWebsiteDetail")
            )}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-k">{t("results.owner")}</span>
          <span className="detail-v">
            {ownerName ? `${ownerName}${ownerTitle ? ` - ${ownerTitle}` : ""}` : t("results.ownerNotFound")}
            {enrich ? (
              <span className="detail-note">
                {" "}- {t("results.confidence")}{" "}
                {enrich.ownerConfidence === "not_found"
                  ? t("results.ownerMissing").toLowerCase()
                  : enrich.ownerConfidence}
                {enrich.ownerSource && enrich.ownerSource !== "none"
                  ? ` - ${t("results.source")} ${enrich.ownerSource}`
                  : ""}
              </span>
            ) : (
              <span className="detail-note"> - {t("results.runEnrich")}</span>
            )}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-k">{t("results.email")}</span>
          <span className="detail-v">
            {contactEmail || t("status.noEmail")}
            {enrich?.emailSource ? (
              <span className="detail-note">
                {" "}- {t("results.emailSource")}{" "}
                {enrich.emailSource === "scraper"
                  ? t("results.emailSource.scraper")
                  : enrich.emailSource === "crawl"
                    ? t("results.emailSource.crawl")
                    : enrich.emailSource === "pattern"
                      ? t("results.emailSource.pattern")
                      : enrich.emailSource}
              </span>
            ) : null}
            {enrich?.emailType && enrich.emailType !== "unknown" ? (
              <span className="detail-note">
                {" "}- {enrich.emailType === "general" ? t("results.emailType.general") : t("results.emailType.named")}
              </span>
            ) : null}
          </span>
        </div>
        <div>
          Intent: {enrich ? `${enrich.intentScore} (${enrich.intentPriority})` : "-"} - signals{" "}
          {enrich ? JSON.stringify(enrich.intentSignals) : "-"}
        </div>
        <div>Icebreaker: {enrich?.icebreaker || "-"}</div>
        <div>Call: {enrich?.callScript || "-"}</div>
        <div>
          Audit: {audit ? `${audit.score} - ${audit.issues.join(",")}` : safeValue("")} - Horarios{" "}
          {safeValue(openHours)}
        </div>
        <div>Direccion: {lead.address || "-"}</div>
        <div>Telefono: {lead.phone || "-"}</div>
        <div>Web: {lead.website || "-"}</div>
        <div>
          Coordenadas: {lead.latitude ?? "-"}, {lead.longitude ?? "-"}
        </div>
      </div>
    </details>
  );
}

export const ResultRow = memo(ResultRowInner);
