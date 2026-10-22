# MAPS LEAD EXTRACTOR V2

> Extractor de leads locales desde Google Maps, orientado a **outbound B2B real**.
> Buscá negocios por zona, enrichelos con owner + email verificado, y salí con
> un Excel listo para contactar — no con una lista de nombres sueltos.

[![Next.js](https://img.shields.io/badge/Next.js-16.2.0-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.2.4-087ea4?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/tpportfolio/maps-lead-extractor?style=social)](https://github.com/tpportfolio/maps-lead-extractor/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/tpportfolio/maps-lead-extractor)](https://github.com/tpportfolio/maps-lead-extractor/commits/main)

> Issues y PRs: [github.com/tpportfolio/maps-lead-extractor/issues](https://github.com/tpportfolio/maps-lead-extractor/issues)

Una lista de negocios solo sirve para outbound cuando cada fila tiene
**owner + email verificado + razón de contacto**. Eso es exactamente lo que
construye esta herramienta.

---

## Índice

- [Qué hace](#qué-hace)
- [Presentación](#presentación)
- [Requisitos](#requisitos)
- [Instalación local](#instalación-local)
- [Cómo se usa](#cómo-se-usa)
- [Docker](#docker)
- [Proxies](#proxies--recomendación-de-uso)
- [Arquitectura](#arquitectura)
- [API](#api)
- [Qué se hizo sobre el repo original](#qué-se-hizo-sobre-el-repo-original)
- [Cómo se trabajó en el repo](#cómo-se-trabajó-en-el-repo)
- [Performance](#performance-medido)
- [Seguridad](#seguridad)
- [Ética y límites](#ética-y-límites)
- [Troubleshooting](#troubleshooting)
- [Licencia y créditos](#licencia-y-créditos)

---

## Qué hace

**1. Buscar** — Elegís una categoría (475 tipos oficiales de Google Places) o
un keyword libre, un radio y una profundidad. El área se cubre con una
**grilla** (no un radio único), que es lo mismo que "Buscar en esta área" de
Google Maps.

**2. Enriquecer** — Por cada negocio:

- **Owner finder heurístico** — busca el nombre de la persona detrás del negocio.
- **Waterfall de email** — scraper → crawl del sitio → patrón típico
  (`info@`, `contacto@`) → validación. Cacheado y con concurrencia limitada.
- **Intent score** — señales de que el negocio está abierto a contratar.
- **Dato local real** — un hecho concreto y verificable del negocio, no
  "saw your Google listing".
- **Icebreaker + call script** — el primer mensaje y el guion de llamada.

**3. Chequear emails** — DNS over HTTPS (Google DoH) contra MX / A / AAAA.
Distingue `valid`, `catch-all` e `invalid`, y separa mailbox `named` de
`general` (los catch-all no se sirven a un `info@`).

**4. Auditar la web** — HTTPS, tiempo de respuesta, viewport, title y
description. Para saber si el negocio tiene una web que sirve o un
`Coming soon`.

**5. Exportar** — CRM (31 campos curados), CSV, Excel, **PDF con fotos** y KML
para Google Maps.

Todo en **español e inglés** (ES/EN), con modo claro/oscuro.

### Decisiones de producto que importan

| Decisión | Por qué |
|---|---|
| Grilla (`-grid-bbox`) en vez de N búsquedas por radio | Cubre el área como lo hace Maps y evita el sesgo de "solo el centro" |
| Post-filtro geográfico por haversine | El scraper no recorta estricto al radio |
| Dedupe por `name + city + domain` | Fusiona sucursales y duplicados que cambian de `place_id` |
| Email con waterfall y cache | Raspar es caro; no se repite trabajo ni se abren conexiones infinitas |
| Concurrencia acotada a 8 | Google rate-limite; abrir cientos de conexiones a la vez te banea |
| Export curado (31 campos) | Un CRM con 200 columnas de JSON no se usa |

---

## Presentación

La presentación completa (**15 slides**) explica el problema, la arquitectura de
extracción y las decisiones técnicas del proyecto.

[![Vista general de la presentación: 15 slides](docs/presentacion/vista-general.jpg)](docs/presentacion/maps-lead-extractor.pdf)

**[Ver la presentación en PDF (15 slides)](docs/presentacion/maps-lead-extractor.pdf)** ·
[Descargar los slides sueltos (JPG)](docs/presentacion)

| Arquitectura en cuatro fases | Anatomía del enriquecimiento |
|---|---|
| [![Arquitectura de extracción](docs/presentacion/slide-03.jpg)](docs/presentacion/slide-03.jpg) | [![Enriquecimiento: owner, email, intent](docs/presentacion/slide-05.jpg)](docs/presentacion/slide-05.jpg) |
| **Seguridad de proxies** | **Rendimiento medido** |
| [![Proxies por archivo, no por línea de comandos](docs/presentacion/slide-09.jpg)](docs/presentacion/slide-09.jpg) | [![Rendimiento: 499 KB, 17 ms, 475 tipos](docs/presentacion/slide-13.jpg)](docs/presentacion/slide-13.jpg) |

---

## Requisitos

| | Versión mínima | Para qué |
|---|---|---|
| **Node.js** | 20 LTS (probado en 24) | La app web y el scraper |
| **npm** | 10+ | Dependencias |
| **Docker Desktop** | 4.x (probado en 29.8) | Corre el scraper de Google Maps |
| **Disco** | ~4 GB libres | Imagen del scraper (2 GB) + `node_modules` |

> **Windows**: la app usa `spawn` de Node para invocar Docker. Si tenés
> PowerShell 7 o Windows Terminal, andá con eso; el `cmd` clásico funciona
> pero algunos antivirus preguntan por el acceso a Docker.

---

## Instalación local

```bash
git clone https://github.com/tpportfolio/maps-lead-extractor.git
cd maps-lead-extractor
```

### 1. Dependencias de la app

La app vive en `apps/web`. El scraper (`services/scraper`) usa **solo módulos
nativos de Node** — no tiene dependencias que instalar.

```bash
cd apps/web
npm install
```

### 2. Verificá que Docker está corriendo

```bash
docker info
```

Si abre un error, abrí **Docker Desktop** y esperá a que diga `Running`.
Sin Docker, la app abre igual pero el botón **Buscar** no scrapea nada.

### 3. Levantá la app

```bash
cd apps/web
npm run dev
```

Abrí **http://localhost:3000**.

<details>
<summary><b>Atajo en Windows</b></summary>

Hay un `INICIAR_MAPS_V2.bat` en la raíz del repo. Doble click: levanta el
dev server, chequea Docker y abre el navegador. Funciona desde cualquier
carpeta porque usa `%~dp0` (ruta del propio script).
</details>

### 4. Build de producción (opcional)

```bash
cd apps/web
npx next build --webpack     # ojo: ver nota abajo
npx next start -p 3000
```

> **Nota sobre el build**: `npm run build` usa Turbopack y **falla** con
> *"server relative imports are not implemented yet"* porque la ruta del
> scraper se resuelve en runtime con `path.join(cwd, ...)`. Usá
> `npx next build --webpack`, que funciona. (Es un límite de Turbopack con
> `spawn`, no un problema del código.)

### 5. Dockerfile / Docker Compose

No hace falta: la app **llama a Docker desde Node** en runtime
(`docker run --rm ... gosom/google-maps-scraper`). Docker es un requisito,
no un paso de build.

---

## Cómo se usa

### Buscar

1. **Categoría / nicho** — elegí de las 475 categorías de Google Places, o
   escribí un keyword libre (sugerencias automáticas incluidas).
2. **Radio** — en km desde el punto que marques en el mapa.
3. **Profundidad** — cuántas páginas de resultados raspar por celda
   (1 = rápido, 5 = exhaustivo).
4. **Buscar** — el botón arranca el scrape. Podés **cancelarlo**: el output
   parcial queda guardado y la próxima corrida idéntica **se reanuda** sola.

### Filtrar y enriquecer

Los filtros de calidad (mínimo de reseñas, rating, con teléfono, con web,
excluir cadenas) se aplican después del scrape. **Enriquecer** es una pasada
aparte: es lo que trae el owner y los emails, y conviene correrla una vez
sobre los leads que ya pasaron el filtro.

### Exportar

CRM (31 campos) · CSV · Excel · PDF con fotos · KML.

---

## Docker

### Qué corre

El scrape delega en
[`gosom/google-maps-scraper`](https://github.com/gosom/google-maps-scraper)
(v1.18.1), que maneja Playwright, la paginación de Maps y el parseo.

```bash
docker run --rm \
  -v <workspace>/queries.txt:/example-queries \
  -v <workspace>/results.json:/results.json \
  gosom/google-maps-scraper \
  -input /example-queries \
  -results /results.json \
  -json \
  -depth 5 \
  -lang es \
  -grid-bbox <minLat,minLon,maxLat,maxLon> \
  -grid-cell 0.5 \
  -zoom 16
```

### Detalles que importan

- **La imagen pesa 2 GB** y ya trae los navegadores de Playwright dentro.
  No hace falta montar un volumen de cache.
- **Los `-v` van ANTES del nombre de la imagen**; los flags de la app,
  después. Al revés, Docker interpreta el `-v` como flag del binario y falla.
- **`-lang es`** sin esto el scraper scrapea en inglés y los resultados no
  coinciden con lo que el usuario ve en Maps.
- **`-depth`** es el knob de exhaustividad. Más depth = más resultados =
  más tiempo y más riesgo de rate limit.
- **El contenedor se nombra** (`lead-scrape-<pid>-<ts>`) para poder
  detenerlo en el acto al cancelar. Sin eso, cancelar la búsqueda dejaba el
  contenedor raspando en background.
- **`DISABLE_TELEMETRY=1`** si querés cortar la telemetría anónima del
  scraper (agregalo como env al `docker run`).

### Reanudar una corrida cortada

Si el scrape se corta (Docker se cae, cerrás la laptop, cancelás), el output
parcial **queda en disco**. La próxima vez que hacés **exactamente la misma
búsqueda**, la app detecta la sesión y reanuda: lee lo que ya hay, saltea
los lugares ya raspados y sigue.

- Cambiá cualquier parámetro (radio, categoría, profundidad) → arranca de cero.
- Con el checkbox **"Buscar desde cero"** → fuerza arranque limpio.
- Solo puede haber **una corrida activa por búsqueda** (hay un lock por
  sesión): si la anterior sigue viva, la app te avisa en vez de corromper
  los datos.

---

## Proxies — recomendación de uso

**Resumen corto**: no hace falta un proxy para probar. Sí lo necesitás si
vas a raspar **mucho** (varias ciudades, búsquedas repetidas, `depth` alto)
o si te bloquean.

### Por qué

Google Maps rate-limite por IP. Sin proxy, una búsqueda grande puede
devolverte pocos resultados o un bloqueo temporal. Los proxies reparten el
tráfico y evitan el bloqueo.

### Formatos aceptados

```
http://usuario:password@host:puerto
socks5://host:puerto
https://host:puerto
```

Uno por línea, separados por coma en la UI. El formato se valida antes de
correr: si **todos** los proxies son inválidos, la búsqueda falla con un
error claro en vez de colgarse.

### Por qué el proxy va por archivo y no en la línea de comandos

Esto es un detalle de **seguridad** que vale la pena conocer:

```bash
# MAL: la contraseña queda en la línea de comandos del proceso docker.exe
docker run ... -proxies http://user:MIPASS@proxy:8080 ...

# BIEN: la contraseña va en un archivo montado con permisos 0600
docker run ... -v proxies.txt:/proxies.txt ... -proxies-file /proxies.txt
```

Con `-proxies` inline, cualquier programa del equipo puede leer la
contraseña desde la lista de procesos (`ps`, el Administrador de tareas, o
`Get-CimInstance Win32_Process` en Windows). Esta app usa **siempre**
`-proxies-file`: las credenciales viajan por stdin y se montan en un archivo
con permisos restringidos, y los logs las redactan.

### Recomendación práctica

- **Para probar** (una búsqueda, radio chico, depth 2-3): sin proxy.
- **Para trabajar en serio**: un proxy **residencial o ISP rotativo**, no de
  datacenter. Los de datacenter están bloqueados más rápido.
- **Empezá con 1-2 proxies**. Más no es mejor: el scraper reparte las
  consultas entre los que le des, y cada proxy novo es más lento de
 aparecer en los logs de Google.
- **No pongas proxies en un build compartido.** El campo de proxies es
  **efímero**: vive en memoria, no se persiste en disco, y no se sube al
  repo.
- **Si te bloquean**: bajá `depth`, subí el radio por partes, esperá un
  rato. El flag `-c` (concurrencia) es el otro knob — pero más concurrencia
  significa más chance de bloqueo.

---

## Arquitectura

```
.
├── apps/web/                    App Next.js 16 (App Router) + React 19
│   ├── app/
│   │   ├── page.tsx             Layout, barra de estado, vistas
│   │   ├── globals.css          Design system (terminal retro)
│   │   └── api/leads/
│   │       ├── search/          Orquestación: grilla, sesión, dedupe, filtros
│   │       ├── enrich/          Owner + waterfall + intent + local fact
│   │       ├── email-check/     DNS over HTTPS + cache
│   │       ├── audit-website/   Auditoría web + cache
│   │       └── image/           Proxy de thumbnails (whitelist anti-SSRF)
│   ├── components/              Formulario, mapa, filas, picker de categorías
│   └── lib/
│       ├── concurrency.ts       Pool de concurrencia + TtlCache
│       ├── session-results.ts   Estado de sesión en disco (leer/unir/mergear)
│       ├── enrichment.ts        Lógica de owner / intent / local fact
│       ├── export-schema.ts     Los 31 campos del export
│       └── pdf-export.ts        PDF con fotos
│
├── packages/shared/constants/   475 tipos oficiales de Google Places + traducción ES
│
└── services/scraper/            Invocación a Docker (sin dependencias externas)
    └── src/run-google-maps.js
```

**Flujo de una búsqueda:**

```
UI → POST /api/leads/search
       → resolveSession()  (¿hay sesión? ¿reanudar?)
       → lock de sesión
       → node services/scraper/run-google-maps.js  (stdin: payload JSON)
            → docker run gosom/google-maps-scraper
            → lee results.json → items JSON
       → merge defensivo (stdout ∪ archivo ∪ previos)
       → dedupe + filtros de calidad + recorte por radio
       → JSON → UI
```

---

## API

Todos los endpoints son `POST` salvo los marcados.

| Endpoint | Qué hace |
|---|---|
| `POST /api/leads/search` | Scrape. Body: `query`, `customKeyword`, `radiusKm`, `center`, `depth`, `lang`, `includeEmails`, `proxies`, `fresh` |
| `POST /api/leads/enrich` | Owner + emails + intent + local fact. Body: array de leads |
| `POST /api/leads/email-check` | Verificación DNS. Body: `emails[]` |
| `POST /api/leads/audit-website` | Auditoría. Body: `url` |
| `GET /api/leads/image` | Proxy de thumbnails con whitelist de hosts |
| `GET /api/health` | Health check |

**Variables de entorno**: ninguna. No hay `.env`, ni claves, ni tokens. Todo
se configura desde la UI. Si algún día agregás una, ponelas en `.gitignore` (ya está cubierto por `.env*`) y subí solo un `.env.example`.

---

## Qué se hizo sobre el repo original

La V2 parte de una versión anterior y le agrega bastante. Esto es lo que
**realmente se hizo**, con la evidencia de cada decisión:

### Auditoría del upstream (`gosom/google-maps-scraper`)

Se auditó la versión local contra el repo upstream:

- **Estamos al día**: la imagen local es la **v1.18.1** (revision OCI
  `549e4b5e`, el commit del tag). Los 3 commits posteriores son de docs y
  sponsors, sin cambios funcionales.
- **Validado**: `-grid-bbox` + `-grid-cell` con `-depth 5` es el patrón
  oficial de los ejemplos upstream.
- **Descartado con medición** — el volumen `gmaps-playwright-cache:/opt` de
  los ejemplos oficiales **no aporta nada**: la imagen ya trae 776 MB de
  navegadores y el "Downloading browsers" tarda menos de 1 segundo.
- **Descartado con medición** — el tuning de browser pool
  (`-pages-per-browser 4 -browser-pool-size 2`) es **peor**: 3.175 GB de RAM
  y 387% de CPU, contra **896 MiB y 72%** de los defaults.
- **Implementado**: `-proxies-file` (seguridad) y `-resume` (continuar una
  corrida cortada).

### Correcciones de bugs

| Bug | Antes | Ahora |
|---|---|---|
| Review count / rating | Leía `rating` / `reviews` (siempre `undefined`) | Lee `review_rating` / `review_count` (los nombres reales del scraper) |
| Cancelar la búsqueda | El contenedor seguía raspando en background | Se detiene por nombre (`docker stop`) |
| Export con textos no latinos | **pdf-lib crasheaba** y se perdía el PDF entero | Sanitizado a WinAnsi, el PDF sale siempre |
|Resultados con `place_id` cambiante | Duplicados de la misma sucursal | Dedupe por `name + city + domain` |
| PDF con fotos | Alturas distintas por foto | Tamaño unificado (46×46 pt) |
| Fan-out de red | 200 requests simultáneos en enrich | Pool acotado a 8 |
| DNS repetido | 565 ms por consulta | 17 ms (cache con TTL) |
| Query en Maps | Cambiaba el orden vs la UI de Maps | Sufijo `near` eliminado: la grilla ya ubica |
| PDF en el bundle inicial | 999.8 KB | 499 KB (pdf-lib y xlsx lazy) |

### Lo que se agrejó

Filtros de calidad (reviews / rating / teléfono / web / cadenas), supresión de
contactados, owner finder heurístico, waterfall de email con validación,
intent score, local fact + icebreaker + call script, auditoría web real,
vistas de resultados / calling / copy, export CRM curado + PDF con fotos +
KML, catálogo de 475 tipos de Google con buscador predictivo, i18n ES/EN,
modo claro/oscuro, reanudación de corridas y proxies por archivo.

### Cómo se testea

No hay framework de tests (es un proyecto de scripts), pero hay un set de
verificaciones reales:

| Qué | Cómo |
|---|---|
| Tipos | `npx tsc --noEmit` → 0 errores |
| Lint | `npx eslint .` → 0 errores |
| Build | `npx next build --webpack` |
| Scraper | `node --check services/scraper/src/run-google-maps.js` |
| Sesión / resume | Test unitario de `lib/session-results.ts` (12 asserts, incluye el caso "el scraper trunca a 4 con 74 previos") |
| E2E del resume | Interrumpir la búsqueda → verificar que el parcial queda en disco → reanudar → verificar que el count acumulado incluye los previos |
| Concurrencia | Dos POST simultáneos con la misma firma → el 2º tiene que recibir 409, no corromper el 1º |
| Credenciales | Buscar con un proxy que tiene password → inspeccionar la command line de `docker.exe` → no debe aparecer la contraseña |

---

## Cómo se trabajó en el repo

Este proyecto se desarrolló con **agentes de IA** como co-autores, no con un
IDE vacío. El flujo real:

1. **Contexto primero** — se leyó el material de referencia (el curso de
   scraping de Google Maps) y se tradujo a un modelo de producto: una lista
   solo sirve si tiene owner + email + razón de contacto.
2. **Auditoría antes de escribir** — se auditó el repo upstream y se
   **descartó con medición** lo que no aportaba (el volumen de browsers, el
   tuning de pool). Cada decisión quedó con su número.
3. **Implementación por capas** — búsqueda → enriquecimiento → verificación →
   auditoría → export → performance → seguridad. Cada capa con su verificación.
4. **Perfilado de performance real** — se midió bundle, fan-out y cacheo, y
   se corrigió con números, no con intuición.
5. **Documentación continua** — un `handoff.md` interno con el estado, las
   decisiones que no hay que revertir y los gotchas del entorno, para que
   cualquier sesión arranque sabiendo todo.

**Modelos y herramientas usados:**

| Herramienta | Para qué |
|---|---|
| **Claude Code** (Opus / Sonnet) | Diseño de producto, refactors grandes, arquitectura |
| **Codex** | Chequeos de tipos y revisiones de código |
| **opencode** (minimax-m3.1-flash) | Implementación iterativa, debugging con probes, tests, documentación |
| **ripgrep / Node / PowerShell** | Búsqueda y edición (Node para reemplazar texto: PowerShell rompe acentos y CRLF) |

Los archivos `AGENTS.md` y `CLAUDE.md` del repo tienen las reglas que siguen
los agentes al trabajar acá.

---

## Performance (medido)

| Métrica | Valor |
|---|---|
| Bundle inicial | **499 KB** (era 999.8 KB) |
| Concurrencia de red | 8 (era 200 simultáneos) |
| DNS: 1ª consulta → 2ª | **565 ms → 17 ms** (cache TTL 1 h) |
| Reanudación | Merge defensivo: el output parcial no se pierde nunca |
| Build | `next build --webpack` compila en ~2 s (warm) |

---

## Seguridad

Qué hace esta app:

- **Los proxies no van nunca en la línea de comandos** (van por archivo 0600
  + stdin), y los logs los redactan.
- **El campo de proxies es efímero**: no se persiste, no se exporta, no se
  sube al repo.
- **Whitelist anti-SSRF** en el proxy de imágenes: solo hosts de Google.
- **El proxy de thumbnails** no hace de open proxy.
- **No hay secretos en el repo**: cero `.env`, cero API keys, cero tokens.
- **Doble sanitización** en el PDF: control de caracteres + WinAnsi, para
  que un texto en árabe o cirílico no rompa la exportación.

Qué **no** hace (y conviene saber):

- **No hay autenticación.** La app está pensada para correr local. Si la
  exponés a internet, poné un proxy inverso con auth (basic auth de Nginx,
  Cloudflare Access, Vercel con password) **antes**.
- **No hay rate limiting** en la API.
- **El scraping de Google Maps puede violar los ToS de Google.** Ver la
  sección siguiente.

---

## Ética y límites

- Google Maps **prohíbe el scraping automatizado** en sus Términos de
  Servicio. Esta herramienta es para **investigación de mercado con fines
  propios**, no para redistribuir datos de Google ni para carga masiva
  contra su infraestructura.
- **La responsabilidad es del que la usa.** Si la usás comercialmente,
  evaluá un proveedor de datos con licencia (Places API de Google, Data
  ForSEO, LocalStack, etc.). El costo de la API oficial suele ser menor que
  el riesgo de que te bloqueen.
- **No la uses para spam.** Los datos de email son para contacto comercial
  one-to-one y con baja fácil. Cumplí la normativa de tu país (GDPR, LSSI,
  Ley de Protección de Datos Personales, CAN-SPAM, CASL…).
- **El scraping de sitios de terceros para extraer emails** tiene su propia
  zona gris: respetá `robots.txt` y no bombardees sitios pequeños.
- Los tipos de lugares vienen de la **tabla oficial de Google Places** (Tabla
  A). Verificá la licencia de redistribución antes de republicar el catálogo.

---

## Troubleshooting

**El botón Buscar no hace nada / da error de Docker**
Docker Desktop no está corriendo. `docker info` te dice. La app abre igual,
pero sin Docker no hay scrape.

**"Ya hay una búsqueda en curso para esta misma búsqueda" (409)**
La corrida anterior sigue viva. Cancelala o esperá. Si el server se reinició
y el lock quedó colgado, se libera solo.

**La búsqueda tarda muchísimo**
`depth` alto + `-email` activado es lento (medido: 62 lugares = 206 s con
`-email` vs ~30 s sin). Bajá `depth`, sacá el flag de emails (o corré
**Enriquecer** después, que hace lo mismo con cache), o dividí el radio en
cuadrantes.

**"La columna X no trae datos"**
- `review_count` / `rating`: el scraper no los devuelve para todos los
  negocios. Es normal.
- `email`: muchos negocios no tienen, o el waterfall no los encuentra.
- `owner`: es heurístico. Un match no es una certeza.

**El build falla con Turbopack**
Usá `npx next build --webpack`. Ver la nota de instalación.

**Antivirus de Windows bloquea el scrape**
Windows Defender a veces marca el acceso al socket de Docker. Agregá una
exclusión para `node.exe` y para el proceso de Docker.

---

## Licencia y créditos

**MIT** — ver [LICENSE](LICENSE).

- Los tipos de lugares vienen de la **tabla oficial de Google Places**
  (Tabla A).
- El scraping lo hace
  [`gosom/google-maps-scraper`](https://github.com/gosom/google-maps-scraper)
  (MIT), que envuelve Playwright.
- Mapas: [Leaflet](https://leafletjs.com) + [OpenStreetMap](https://www.openstreetmap.org/copyright).
- Fuentes: [Sora](https://fonts.google.com/specimen/Sora) +
  [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono).
- Export: [pdf-lib](https://pdf-lib.js.org) + [SheetJS](https://sheetjs.com).
