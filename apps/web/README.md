# apps/web — MAPS LEAD EXTRACTOR

App Next.js (App Router) del extractor de leads. **La documentación completa
está en el [README del repo](../README.md).**

## Comandos

```bash
npm install     # primera vez
npm run dev     # http://localhost:3000
npm run lint    # eslint
npx tsc --noEmit   # chequeo de tipos (0 errores)

# build de producción: usar --webpack, Turbopack falla con spawn + rutas relativas
npx next build --webpack
npx next start -p 3000
```

## Qué hay acá

| Ruta | Qué hace |
|---|---|
| `app/page.tsx` | Layout, barra de estado, vistas resultados / calling / copy |
| `app/api/leads/search` | Scrape: grilla, sesión persistente, dedupe, filtros de calidad |
| `app/api/leads/enrich` | Owner finder, waterfall de email, intent score, local fact |
| `app/api/leads/email-check` | DNS over HTTPS con cache |
| `app/api/leads/audit-website` | Auditoría web con cache |
| `app/api/leads/image` | Proxy de thumbnails con whitelist anti-SSRF |
| `components/` | Formulario, mapas (Leaflet), filas memoizadas, picker de categorías |
| `lib/session-results.ts` | Estado de sesión en disco: leer / escribir / mergear |
| `lib/concurrency.ts` | Pool de concurrencia y cache con TTL |
| `lib/export-schema.ts` | Los 31 campos del export CRM |
| `lib/pdf-export.ts` | PDF con fotos (sanitizado a WinAnsi) |

## Dependencias

`next` · `react` · `react-dom` · `leaflet` · `react-leaflet` · `pdf-lib` · `xlsx`

Sin variables de entorno, sin claves, sin base de datos.
