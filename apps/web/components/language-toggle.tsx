"use client";

import { useI18n, type Lang } from "@/lib/i18n";

export default function LanguageToggle() {
  const { lang, setLang } = useI18n();

  const options: { value: Lang; label: string }[] = [
    { value: "es", label: "ES" },
    { value: "en", label: "EN" },
  ];

  return (
    <div className="lang-switch" role="group" aria-label="Idioma / Language">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`lang-btn ${lang === opt.value ? "is-active" : ""}`}
          onClick={() => setLang(opt.value)}
          aria-pressed={lang === opt.value}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
