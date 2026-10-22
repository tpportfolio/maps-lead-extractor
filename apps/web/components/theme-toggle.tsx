"use client";

import { useCallback, useEffect, useState } from "react";

type ThemeMode = "terminal" | "light";

const THEME_STORAGE_KEY = "t8b_theme_mode";

function readStoredMode(): ThemeMode {
  if (typeof window === "undefined") return "terminal";
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "light" || saved === "terminal") return saved;
  const legacy = window.localStorage.getItem("theme");
  if (legacy === "light") return "light";
  return "terminal";
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>(readStoredMode);

  const applyTheme = useCallback((nextTheme: "dark" | "light") => {
    document.documentElement.dataset.theme = nextTheme;
    document.body.setAttribute("data-theme", nextTheme);
  }, []);

  useEffect(() => {
    applyTheme(mode === "light" ? "light" : "dark");
  }, [mode, applyTheme]);

  const toggle = () => {
    const nextMode: ThemeMode = mode === "terminal" ? "light" : "terminal";
    setMode(nextMode);
    const nextTheme = nextMode === "light" ? "light" : "dark";
    applyTheme(nextTheme);
    document.documentElement.setAttribute("data-mode", nextMode);
    document.body.setAttribute("data-mode", nextMode);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
    window.localStorage.setItem("theme", nextTheme);
  };

  return (
    <div className="t8b-mode-switch" role="group" aria-label="Theme mode">
      <span className={`t8b-mode-btn ${mode === "terminal" ? "is-active" : ""}`}>Dark</span>
      <button
        type="button"
        className="t8b-mode-track"
        onClick={toggle}
        aria-label={mode === "terminal" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
        aria-pressed={mode === "light"}
      >
        <span className="t8b-mode-thumb" />
      </button>
      <span className={`t8b-mode-btn ${mode === "light" ? "is-active" : ""}`}>Light</span>
    </div>
  );
}
