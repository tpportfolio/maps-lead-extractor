"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Lang = "es" | "en";

type Dict = Record<string, string>;

const DICT_ES: Dict = {
  "brand.tagline": "Extractor de leads locales desde Google Maps. Corre 100% en tu maquina.",
  "nav.map": "Vista mapa",
  "nav.filters": "Filtros",
  "nav.results": "Resultados",
  "nav.export": "Exportar",

  "form.category": "Categoria / nicho",
  "form.keyword": "Keyword libre",
  "form.keyword.hint": "Si lo completas, busca esa palabra e ignora la categoria de arriba.",
  "form.radius": "Radio (km)",
  "form.time": "Tiempo de busqueda",
  "form.minReviews": "Min reviews",
  "form.maxReviews": "Max reviews",
  "form.minRating": "Min rating",
  "form.withPhone": "Con telefono",
  "form.withWeb": "Con web",
  "form.excludeChains": "Excluir cadenas",
  "form.search": "Buscar",
  "form.cancel": "Cancelar busqueda",
  "form.radius.hint": "Flechas arriba/abajo o teclas 1-7 sobre el campo.",
  "form.scrapeEmails": "Extraer emails en la busqueda",
  "form.scrapeEmails.hint": "Raspia cada web de negocio. Apagado por defecto: Enriquecer hace el mismo trabajo con cache y la busqueda va hasta 7 veces mas rapido.",
  "form.cancel.done": "Busqueda cancelada.",
  "form.fresh": "Buscar desde cero",
  "form.fresh.hint": "Desactivalo para ignorar la corrida anterior y empezar de nuevo.",
  "search.resumed": "Reanudando corrida anterior",
  "search.resumed.previous": "de la corrida anterior",
  "form.proxies": "Proxies (opcional)",
  "form.proxies.hint": "Uno por coma. Reduce el rate limiting de Google en volumen. No se guarda: se borra al recargar.",

  "filters.title": "Filtros y enriquecimiento",
  "filters.category": "Filtrar categoria",
  "filters.insideRadius": "Solo dentro del radio",
  "filters.withEmail": "Solo con email",
  "filters.validEmail": "Solo email validado",
  "filters.emailCheck": "Chequeo de emails",
  "filters.runCheck": "Ejecutar chequeo",
  "filters.order": "Orden",
  "filters.order.score": "Por intent score",
  "filters.order.reviews": "Por reviews",
  "filters.order.distance": "Por distancia",
  "filters.enrich": "Enriquecer (owner + waterfall + local fact)",
  "filters.enrichRun": "Enriquecer",
  "filters.enrichRunning": "Enriqueciendo...",
  "filters.enriched": "enriquecidos",
  "filters.audit": "Auditoria web real",
  "filters.auditRun": "Auditar webs",
  "filters.auditRunning": "Auditando...",
  "filters.audited": "auditados",
  "filters.view": "Vista",
  "filters.view.results": "resultados",
  "filters.view.resultados": "resultados",
  "filters.view.calling": "calling",
  "filters.view.copy": "copy",
  "filters.contacted": "contactados (supresion)",
  "filters.resetWidths": "Restablecer anchos",

  "results.title": "Resultados",
  "results.stats": "Total",
  "results.filtered": "filtrados",
  "results.withCoords": "Con coords",
  "results.inside": "Dentro",
  "results.outside": "Fuera",
  "results.center": "Centro",
  "results.visibleInside": "Visibles dentro",
  "results.closest": "Mas cercano",
  "results.noVisible": "Sin visibles (supresion/filtros). Revisa filtros o limpia contactados.",
  "results.enrichTip": "Tip curso: corre ENRIQUECER para owner + intent + local fact antes de exportar.",
  "results.col.business": "Empresa + score",
  "results.col.contact": "Contacto",
  "results.col.website": "Website Maps",
  "results.col.owner": "Owner / Email",
  "results.col.localFact": "Local fact",
  "results.col.status": "Estado",
  "results.noWebsite": "Sin web en Maps",
  "results.declaredInMaps": "declarado en Google Maps",
  "results.noWebsiteDetail": "Sin website declarado",
  "results.owner": "Dueno",
  "results.ownerNotFound": "No detectado en la web del negocio",
  "results.ownerMissing": "Dueno no detectado",
  "results.email": "Email",
  "results.emailSource": "origen",
  "results.emailSource.scraper": "Google Maps",
  "results.emailSource.crawl": "web del negocio",
  "results.emailSource.pattern": "estimado",
  "results.emailType.general": "casilla general",
  "results.emailType.named": "personal",
  "results.intent": "Intent",
  "results.icebreaker": "Icebreaker",
  "results.call": "Call",
  "results.audit": "Auditoria",
  "results.address": "Direccion",
  "results.phone": "Telefono",
  "results.web": "Web",
  "results.coords": "Coordenadas",
  "results.confidence": "confianza",
  "results.source": "fuente",
  "results.runEnrich": "corre Enriquecer para detectarlo",

  "status.noEmail": "Sin email",
  "status.noValid": "Sin validar",
  "status.valid": "Validado",
  "status.catchAll": "Catch-all",
  "status.invalid": "Invalido",
  "status.uncertain": "Incierto",
  "status.contacted": "Contactado",
  "status.markContacted": "Marcar contactado",
  "status.validEmails": "Validos",
  "status.invalidEmails": "Invalidos",
  "status.uncertainEmails": "Inciertos",
  "status.catchAllEmails": "Catch-all",

  "export.title": "Exportar",
  "export.crm": "Exportar CRM",
  "export.csv": "Exportar CSV",
  "export.excel": "Exportar Excel",
  "export.pdf": "Exportar PDF",
  "export.kml": "Exportar Google Maps",

  "map.title": "Mapa de resultados",
  "log.title": "Log tecnico",
  "log.debug": "Debug",
  "log.coords": "posibles coords",
  "log.none": "Sin datos de debug.",

  "calling.score": "score",
  "calling.noPhone": "sin telefono",
  "calling.call": "Llamar",
  "copy.copy": "Copiar",
  "copy.localFact": "Local fact",
  "copy.competitor": "Competidor",

  "empty.title": "Sin resultados todavia",
  "empty.body": "Elegi un nicho, marca el centro en el mapa y corre Buscar. Despues corre Enriquecer para owner, intent y website de Maps antes de exportar.",
  "loading.searching": "Buscando en Google Maps...",
  "loading.placeholder": "Cargando resultados",

  "picker.search": "Buscar categoria...",
  "picker.all": "Todas las categorias",
  "picker.recommended": "Recomendados",
  "picker.allLabel": "Todas",
  "picker.noResults": "Sin resultados",
  "picker.typeCount": "tipos oficiales de Google Maps.",
  "picker.close": "Cerrar",
};

const DICT_EN: Dict = {
  "brand.tagline": "Local lead extractor from Google Maps. Runs 100% on your machine.",
  "nav.map": "Map view",
  "nav.filters": "Filters",
  "nav.results": "Results",
  "nav.export": "Export",

  "form.category": "Category / niche",
  "form.keyword": "Free keyword",
  "form.keyword.hint": "If filled, searches that word and ignores the category above.",
  "form.radius": "Radius (km)",
  "form.time": "Search time",
  "form.minReviews": "Min reviews",
  "form.maxReviews": "Max reviews",
  "form.minRating": "Min rating",
  "form.withPhone": "With phone",
  "form.withWeb": "With web",
  "form.excludeChains": "Exclude chains",
  "form.search": "Search",
  "form.cancel": "Cancel search",
  "form.radius.hint": "Arrow up/down or keys 1-7 while focused on the field.",
  "form.scrapeEmails": "Extract emails during search",
  "form.scrapeEmails.hint": "Crawls every business website. Turn it off if you run Enrich afterwards: it does the same job and the search runs faster.",
  "form.cancel.done": "Search cancelled.",
  "form.fresh": "Search from scratch",
  "form.fresh.hint": "Turn off to ignore the previous run and start over.",
  "search.resumed": "Resuming previous run",
  "search.resumed.previous": "from the previous run",
  "form.proxies": "Proxies (optional)",
  "form.proxies.hint": "One per comma. Reduces Google's rate limiting at volume. Not saved: it clears on reload.",

  "filters.title": "Filters and enrichment",
  "filters.category": "Filter category",
  "filters.insideRadius": "Only within radius",
  "filters.withEmail": "Only with email",
  "filters.validEmail": "Only validated email",
  "filters.emailCheck": "Email check",
  "filters.runCheck": "Run check",
  "filters.order": "Sort",
  "filters.order.score": "By intent score",
  "filters.order.reviews": "By reviews",
  "filters.order.distance": "By distance",
  "filters.enrich": "Enrich (owner + waterfall + local fact)",
  "filters.enrichRun": "Enrich",
  "filters.enrichRunning": "Enriching...",
  "filters.enriched": "enriched",
  "filters.audit": "Real web audit",
  "filters.auditRun": "Audit sites",
  "filters.auditRunning": "Auditing...",
  "filters.audited": "audited",
  "filters.view": "View",
  "filters.view.results": "results",
  "filters.view.resultados": "results",
  "filters.view.calling": "calling",
  "filters.view.copy": "copy",
  "filters.contacted": "contacted (suppression)",
  "filters.resetWidths": "Reset widths",

  "results.title": "Results",
  "results.stats": "Total",
  "results.filtered": "filtered",
  "results.withCoords": "With coords",
  "results.inside": "Inside",
  "results.outside": "Outside",
  "results.center": "Center",
  "results.visibleInside": "Visible inside",
  "results.closest": "Closest",
  "results.noVisible": "Nothing visible (suppression/filters). Check filters or clear contacted.",
  "results.enrichTip": "Course tip: run ENRICH for owner + intent + local fact before exporting.",
  "results.col.business": "Business + score",
  "results.col.contact": "Contact",
  "results.col.website": "Website Maps",
  "results.col.owner": "Owner / Email",
  "results.col.localFact": "Local fact",
  "results.col.status": "Status",
  "results.noWebsite": "No web in Maps",
  "results.declaredInMaps": "declared in Google Maps",
  "results.noWebsiteDetail": "No website declared",
  "results.owner": "Owner",
  "results.ownerNotFound": "Not found on the business website",
  "results.ownerMissing": "Owner not detected",
  "results.email": "Email",
  "results.emailSource": "source",
  "results.emailSource.scraper": "Google Maps",
  "results.emailSource.crawl": "business website",
  "results.emailSource.pattern": "estimated",
  "results.emailType.general": "general inbox",
  "results.emailType.named": "personal",
  "results.intent": "Intent",
  "results.icebreaker": "Icebreaker",
  "results.call": "Call",
  "results.audit": "Audit",
  "results.address": "Address",
  "results.phone": "Phone",
  "results.web": "Web",
  "results.coords": "Coordinates",
  "results.confidence": "confidence",
  "results.source": "source",
  "results.runEnrich": "run Enrich to detect it",

  "status.noEmail": "No email",
  "status.noValid": "Not validated",
  "status.valid": "Validated",
  "status.catchAll": "Catch-all",
  "status.invalid": "Invalid",
  "status.uncertain": "Uncertain",
  "status.contacted": "Contacted",
  "status.markContacted": "Mark contacted",
  "status.validEmails": "Valid",
  "status.invalidEmails": "Invalid",
  "status.uncertainEmails": "Uncertain",
  "status.catchAllEmails": "Catch-all",

  "export.title": "Export",
  "export.crm": "Export CRM",
  "export.csv": "Export CSV",
  "export.excel": "Export Excel",
  "export.pdf": "Export PDF",
  "export.kml": "Export Google Maps",

  "map.title": "Results map",
  "log.title": "Technical log",
  "log.debug": "Debug",
  "log.coords": "possible coords",
  "log.none": "No debug data.",

  "calling.score": "score",
  "calling.noPhone": "no phone",
  "calling.call": "Call",
  "copy.copy": "Copy",
  "copy.localFact": "Local fact",
  "copy.competitor": "Competitor",

  "empty.title": "No results yet",
  "empty.body": "Pick a niche, mark the center on the map and run Search. Then run Enrich for owner, intent and Maps website before exporting.",
  "loading.searching": "Searching Google Maps...",
  "loading.placeholder": "Loading results",

  "picker.search": "Search category...",
  "picker.all": "All categories",
  "picker.recommended": "Recommended",
  "picker.allLabel": "All",
  "picker.noResults": "No results",
  "picker.typeCount": "official Google Maps types.",
  "picker.close": "Close",
};

const DICTS: Record<Lang, Dict> = { es: DICT_ES, en: DICT_EN };

const LANG_STORAGE_KEY = "t8b_lang";

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLang(): Lang {
  if (typeof window === "undefined") return "es";
  try {
    const saved = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === "es" || saved === "en") return saved;
  } catch {}
  return "es";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);

  useEffect(() => {
    document.documentElement.setAttribute("data-lang", lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {}
  }, []);

  const t = useCallback(
    (key: string) => DICTS[lang][key] ?? DICTS.es[key] ?? key,
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Fallback para componentes que se renderizan fuera del provider
    return { lang: "es", setLang: () => {}, t: (key: string) => DICT_ES[key] ?? key };
  }
  return ctx;
}
