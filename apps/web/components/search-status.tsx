"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Reloj de la busqueda con estado propio.
 * Antes vivia en el componente padre: cada segundo se re-renderizaba el
 * formulario entero, la lista de resultados y el mapa.
 */
export function ElapsedClock({ running }: { running: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return (
    <div className="text-2xl font-semibold mt-2">
      {minutes}:{seconds.toString().padStart(2, "0")}
    </div>
  );
}

/**
 * Barra de progreso de la busqueda, tambien con estado propio para no
 * re-renderizar el arbol cada 1.2s.
 */
export function SearchProgress({ running }: { running: boolean }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!running) return;
    const tick = window.setTimeout(() => setProgress(5), 0);
    const id = window.setInterval(() => {
      setProgress((p) => (p < 90 ? p + 5 : p));
    }, 1200);
    return () => {
      window.clearTimeout(tick);
      window.clearInterval(id);
    };
  }, [running]);

  useEffect(() => {
    if (running) return;
    // Al terminar: 100% y desvanecer (setState dentro de timers, no en el body)
    const full = window.setTimeout(() => setProgress(100), 0);
    const hide = window.setTimeout(() => setProgress(0), 1400);
    return () => {
      window.clearTimeout(full);
      window.clearTimeout(hide);
    };
  }, [running]);

  if (progress <= 0) return null;

  return (
    <div className="progress-track mt-4">
      <div className="progress-fill" style={{ width: `${progress}%` }} />
    </div>
  );
}
