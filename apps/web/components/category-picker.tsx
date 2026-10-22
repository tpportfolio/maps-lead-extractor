"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  PLACE_TYPE_GROUPS,
  placeTypeLabel,
} from "../../../packages/shared/constants/place-types";
import { PLACE_TYPE_LABELS_ES } from "../../../packages/shared/constants/place-types-es";

const RECOMMENDED_TYPES = [
  "dental_clinic",
  "dentist",
  "medical_clinic",
  "veterinary_care",
  "lawyer",
  "accounting",
  "real_estate_agency",
  "roofing_contractor",
  "plumber",
  "electrician",
  "hair_salon",
  "beauty_salon",
  "butcher_shop",
  "cafe",
  "bakery",
  "gym",
  "fitness_center",
  "car_repair",
  "hardware_store",
  "florist",
];

type PickerProps = {
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
  id?: string;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const GROUP_LABELS_ES: Record<string, string> = {
  automotive: "Automotores",
  business: "Negocios",
  culture: "Cultura",
  education: "Educacion",
  entertainment: "Entretenimiento y recreation",
  facilities: "Instalaciones",
  finance: "Finanzas",
  food: "Comida y bebida",
  geo: "Areas geograficas",
  government: "Gobierno",
  health: "Salud y bienestar",
  housing: "Vivienda",
  lodging: "Alojamiento",
  natural: "Naturaleza",
  worship: "Lugares de culto",
  services: "Servicios",
  shopping: "Compras",
  sports: "Deportes",
  transport: "Transporte",
};

/** Etiqueta visible segun idioma. */
function typeLabel(type: string, lang: "es" | "en"): string {
  if (lang === "es") return PLACE_TYPE_LABELS_ES[type] ?? placeTypeLabel(type);
  return placeTypeLabel(type);
}

/** Etiqueta de grupo segun idioma. */
function groupLabel(groupId: string, lang: "es" | "en"): string {
  if (lang === "es") return GROUP_LABELS_ES[groupId] ?? groupId;
  const group = PLACE_TYPE_GROUPS.find((g) => g.id === groupId);
  return group?.label ?? groupId;
}

export default function CategoryPicker({ value, onChange, includeAll = true, id }: PickerProps) {
  const { lang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const toggle = () => {
    if (!open) setSearch("");
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDocClick = (ev: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const results = useMemo(() => {
    const term = normalize(search.trim());
    const matches = (type: string) => {
      if (!term) return true;
      const es = normalize(PLACE_TYPE_LABELS_ES[type] ?? "");
      const en = normalize(placeTypeLabel(type));
      const id = normalize(type);
      return es.includes(term) || en.includes(term) || id.includes(term);
    };

    const groups: { id: string; label: string; types: string[] }[] = [];
    if (includeAll) {
      groups.push({ id: "TODAS", label: t("picker.allLabel"), types: ["TODAS"] });
    }
    const recommended = RECOMMENDED_TYPES.filter(matches);
    if (recommended.length) {
      groups.push({ id: "recommended", label: t("picker.recommended"), types: recommended });
    }
    for (const group of PLACE_TYPE_GROUPS) {
      const types = group.types.filter(matches);
      if (types.length) {
        groups.push({ id: group.id, label: groupLabel(group.id, lang), types });
      }
    }
    return groups;
    // lang se incluye porque las etiquetas visibles cambian con el idioma
  }, [search, includeAll, lang, t]);

  const totalFound = results.reduce((acc, g) => acc + g.types.length, 0);

  const currentLabel =
    value === "TODAS"
      ? t("picker.all")
      : value
        ? typeLabel(value, lang)
        : t("picker.all");

  return (
    <div className="picker-wrap" ref={wrapRef}>
      <button
        type="button"
        id={id}
        className="input-field picker-trigger"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="picker-value">{currentLabel}</span>
        <svg width="11" height="7" viewBox="0 0 12 8" fill="none" aria-hidden="true" className="picker-caret">
          <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="picker-panel" role="dialog" aria-label={t("picker.search")}>
          <div className="picker-search-row">
            <input
              ref={inputRef}
              className="input-field"
              placeholder={t("picker.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t("picker.search")}
            />
            <span className="picker-count">{totalFound}</span>
          </div>
          <div className="picker-list" role="listbox">
            {totalFound === 0 ? (
              <div className="picker-empty">{t("picker.noResults")}</div>
            ) : (
              results.map((group) => (
                <div key={group.id} className="picker-group">
                  <div className="picker-group-label">{group.label}</div>
                  {group.types.map((type) => {
                    const isAll = type === "TODAS";
                    const label = isAll ? t("picker.allLabel") : typeLabel(type, lang);
                    const selected = value === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        className={`picker-option ${selected ? "is-selected" : ""}`}
                        onClick={() => {
                          onChange(type);
                          setOpen(false);
                        }}
                      >
                        <span className="picker-option-label">{label}</span>
                        {!isAll ? <span className="picker-option-id">{type}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
