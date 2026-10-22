# MAPS LEAD EXTRACTOR V2

> A local lead extractor built on Google Maps, designed for **real B2B outbound**.
> Search businesses by area, enrich them with owner + verified email, and walk
> away with an Excel file ready to contact — not a list of loose names.

[![Next.js](https://img.shields.io/badge/Next.js-16.2.0-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.2.4-087ea4?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Stars](https://img.shields.io/github/stars/tpportfolio/maps-lead-extractor?style=social)](https://github.com/tpportfolio/maps-lead-extractor/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/tpportfolio/maps-lead-extractor)](https://github.com/tpportfolio/maps-lead-extractor/commits/main)

> Issues and PRs: [github.com/tpportfolio/maps-lead-extractor/issues](https://github.com/tpportfolio/maps-lead-extractor/issues)
>
> [Leer en español](README.md)

A business list is only useful for outbound when every row has **owner + verified
email + a reason to reach out**. That is exactly what this tool builds.

---

## Demo

[![Demo: search Google Maps, view the lead table, the map and export](docs/demo.webp)](docs/demo.webp)

_Example search with fictional data (9 hardware stores in Caballito, Buenos
Aires): grid search, lead table, map with radius and export panel._

---

## Index

- [Demo](#demo)
- [What it does](#what-it-does)
- [Presentation](#presentation)
- [Requirements](#requirements)
- [Local installation](#local-installation)
- [How to use it](#how-to-use-it)
- [Docker](#docker)
- [Proxies](#proxies--usage-recommendation)
- [Architecture](#architecture)
- [API](#api)
- [What was done over the original repo](#what-was-done-over-the-original-repo)
- [How the repo was built](#how-the-repo-was-built)
- [Performance](#performance-measured)
- [Security](#security)
- [Ethics and limits](#ethics-and-limits)
- [Troubleshooting](#troubleshooting)
- [License and credits](#license-and-credits)

---

## What it does

**1. Search** — Pick a category (475 official Google Places types) or a free
keyword, a radius and a depth. The area is covered with a **grid** (not a single
radius), which is the same thing Google Maps does with "Search this area".

**2. Enrich** — For every business:

- **Heuristic owner finder** — looks for the person behind the business.
- **Email waterfall** — scraper → site crawl → common pattern (`info@`,
  `contact@`) → validation. Cached and concurrency-limited.
- **Intent score** — signals that the business may be open to hiring.
- **Local fact** — a concrete, verifiable fact about the business, not
  "saw your Google listing".
- **Icebreaker + call script** — the first message and the call outline.

**3. Check emails** — DNS over HTTPS (Google DoH) against MX / A / AAAA.
Distinguishes `valid`, `catch-all` and `invalid`, and separates `named` from
`general` mailboxes (catch-all addresses are not served as `info@`).

**4. Audit the website** — HTTPS, response time, viewport, title and
description. Enough to know whether the business has a working site or a
`Coming soon` page.

**5. Export** — CRM (31 curated fields), CSV, Excel, **PDF with photos** and KML
for Google Maps.

Everything in **Spanish and English** (ES/EN), with light/dark mode.

### Product decisions that matter

| Decision | Why |
|---|---|
| Grid (`-grid-bbox`) instead of N radius searches | Covers the area the way Maps does and avoids the "center only" bias |
| Geographic post-filter with haversine | The scraper does not strictly clip to the radius |
| Dedupe by `name + city + domain` | Merges branches and duplicates that change `place_id` |
| Email waterfall + cache | Scraping is expensive; work is never repeated and connections are bounded |
| Concurrency capped at 8 | Google rate-limits; opening hundreds of connections gets you banned |
| Curated export (31 fields) | A CRM with 200 JSON columns never gets used |

---

## Presentation

The full deck (**15 slides**) explains the problem, the extraction architecture
and the technical decisions behind the project.

[![Presentation overview: 15 slides](docs/presentacion/vista-general.jpg)](docs/presentacion/maps-lead-extractor.pdf)

**[View the presentation as PDF (15 slides)](docs/presentacion/maps-lead-extractor.pdf)** ·
[Download individual slides (JPG)](docs/presentacion)

| Extraction architecture in four phases | Inside the enrichment pipeline |
|---|---|
| [![Extraction architecture](docs/presentacion/slide-03.jpg)](docs/presentacion/slide-03.jpg) | [![Enrichment: owner, email, intent](docs/presentacion/slide-05.jpg)](docs/presentacion/slide-05.jpg) |
| **Proxy security** | **Measured performance** |
| [![Proxies via file, not the command line](docs/presentacion/slide-09.jpg)](docs/presentacion/slide-09.jpg) | [![Performance: 499 KB, 17 ms, 475 types](docs/presentacion/slide-13.jpg)](docs/presentacion/slide-13.jpg) |

---

## Requirements

| | Minimum version | For |
|---|---|---|
| **Node.js** | 20 LTS (tested on 24) | The web app and the scraper |
| **npm** | 10+ | Dependencies |
| **Docker Desktop** | 4.x (tested on 29.8) | Runs the Google Maps scraper |
| **Disk** | ~4 GB free | Scraper image (2 GB) + `node_modules` |

> **Windows**: the app uses Node's `spawn` to invoke Docker. PowerShell 7 or
> Windows Terminal is recommended; classic `cmd` works, but some antivirus
> products ask for permission to access Docker.

---

## Local installation

```bash
git clone https://github.com/tpportfolio/maps-lead-extractor.git
cd maps-lead-extractor
```

### 1. App dependencies

The app lives in `apps/web`. The scraper (`services/scraper`) uses **only native
Node modules** — there is nothing to install there.

```bash
cd apps/web
npm install
```

### 2. Make sure Docker is running

```bash
docker info
```

If it fails, open **Docker Desktop** and wait for `Running`. Without Docker the
app still opens, but the **Search** button scrapes nothing.

### 3. Start the app

```bash
cd apps/web
npm run dev
```

Open **http://localhost:3000**.

<details>
<summary><b>Windows shortcut</b></summary>

There is an `INICIAR_MAPS_V2.bat` file at the repo root. Double-click it: it
starts the dev server, checks Docker and opens the browser. It works from any
folder because it uses `%~dp0` (the script's own path).
</details>

### 4. Production build (optional)

```bash
cd apps/web
npx next build --webpack     # note: see below
npx next start -p 3000
```

> **Build note**: `npm run build` uses Turbopack and **fails** with
> *"server relative imports are not implemented yet"* because the scraper path
> is resolved at runtime with `path.join(cwd, ...)`. Use
> `npx next build --webpack`, which works. This is a Turbopack limitation around
> `spawn`, not a problem in the code.

### 5. Dockerfile / Docker Compose

Not needed: the app **calls Docker from Node** at runtime
(`docker run --rm ... gosom/google-maps-scraper`). Docker is a requirement, not a
build step.

---

## How to use it

### Search

1. **Category / niche** — pick one of the 475 Google Places categories, or type
   a free keyword (autocomplete included).
2. **Radius** — in km from the point you mark on the map.
3. **Depth** — how many result pages to scrape per grid cell (1 = fast,
   5 = exhaustive).
4. **Search** — starts the scrape. You can **cancel it**: partial output stays
   on disk and the next identical run **resumes** automatically.

### Filter and enrich

Quality filters (minimum reviews, rating, has phone, has website, exclude
chains) run after the scrape. **Enrich** is a separate pass: it is what brings
in the owner and emails, and it is best run once on the leads that already
passed the filter.

### Export

CRM (31 fields) · CSV · Excel · PDF with photos · KML.

---

## Docker

### What runs

Scraping is delegated to
[`gosom/google-maps-scraper`](https://github.com/gosom/google-maps-scraper)
(v1.18.1), which handles Playwright, Maps pagination and parsing.

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

### Details that matter

- **The image is 2 GB** and already ships the Playwright browsers. There is no
  need to mount a cache volume.
- **`-v` flags go BEFORE the image name**; app flags go after it. Reversed,
  Docker reads `-v` as a flag for the binary and fails.
- **`-lang es`** — without it the scraper runs in English and results do not
  match what the user sees in Maps.
- **`-depth`** is the exhaustiveness knob. More depth = more results = more time
  and a higher risk of rate limiting.
- **The container is named** (`lead-scrape-<pid>-<ts>`) so it can be stopped
  immediately on cancel. Without this, cancelling a search left the container
  scraping in the background.
- **`DISABLE_TELEMETRY=1`** if you want to disable the scraper's anonymous
  telemetry (add it as an env var to `docker run`).

### Resuming an interrupted run

If a scrape is interrupted (Docker crashes, you close the laptop, you cancel),
partial output **stays on disk**. The next time you run **exactly the same
search**, the app detects the session and resumes: it reads what is already
there, skips places already scraped and continues.

- Change any parameter (radius, category, depth) → starts from scratch.
- With the **"Search from scratch"** checkbox → forces a clean run.
- There can only be **one active run per search** (a per-session lock): if the
  previous one is still alive, the app tells you instead of corrupting data.

---

## Proxies — usage recommendation

**Short version**: you do not need a proxy to try it. You do need one if you
plan to scrape **a lot** (several cities, repeated searches, high `depth`) or if
you get blocked.

### Why

Google Maps rate-limits by IP. Without a proxy, a large search may return few
results or a temporary block. Proxies spread traffic and avoid the block.

### Accepted formats

```
http://user:password@host:port
socks5://host:port
https://host:port
```

One per line, comma-separated in the UI. The format is validated before running:
if **every** proxy is invalid, the search fails with a clear error instead of
hanging.

### Why proxies go through a file and not the command line

This is a **security** detail worth knowing:

```bash
# BAD: the password is visible in the docker.exe process command line
docker run ... -proxies http://user:MYPASS@proxy:8080 ...

# GOOD: the password lives in a mounted file with 0600 permissions
docker run ... -v proxies.txt:/proxies.txt ... -proxies-file /proxies.txt
```

With inline `-proxies`, any program on the machine can read the password from
the process list (`ps`, Task Manager, or `Get-CimInstance Win32_Process` on
Windows). This app **always** uses `-proxies-file`: credentials travel through
stdin and are mounted into a restricted file, and logs redact them.

### Practical advice

- **To try it** (one search, small radius, depth 2-3): no proxy.
- **For real work**: a **residential or rotating ISP** proxy, not datacenter.
  Datacenter proxies get blocked faster.
- **Start with 1-2 proxies**. More is not better: the scraper spreads queries
  across whatever you give it, and each new proxy is slower to warm up in
  Google's logs.
- **Never put proxies in a shared build.** The proxy field is **ephemeral**: it
  lives in memory, is not persisted to disk and is not uploaded to the repo.
- **If you get blocked**: lower `depth`, increase the radius in steps, wait a
  while. The `-c` flag (concurrency) is the other knob — but more concurrency
  means a higher chance of getting blocked.

---

## Architecture

```
.
├── apps/web/                    Next.js 16 (App Router) + React 19 app
│   ├── app/
│   │   ├── page.tsx             Layout, status bar, views
│   │   ├── globals.css          Design system (retro terminal)
│   │   └── api/leads/
│   │       ├── search/          Orchestration: grid, session, dedupe, filters
│   │       ├── enrich/          Owner + waterfall + intent + local fact
│   │       ├── email-check/     DNS over HTTPS + cache
│   │       ├── audit-website/   Website audit + cache
│   │       └── image/           Thumbnail proxy (anti-SSRF whitelist)
│   ├── components/              Form, map, rows, category picker
│   └── lib/
│       ├── concurrency.ts       Concurrency pool + TtlCache
│       ├── session-results.ts   On-disk session state (read/join/merge)
│       ├── enrichment.ts        Owner / intent / local fact logic
│       ├── export-schema.ts     The 31 export fields
│       └── pdf-export.ts        PDF with photos
│
├── packages/shared/constants/   475 official Google Places types + ES translation
│
└── services/scraper/            Docker invocation (no external dependencies)
    └── src/run-google-maps.js
```

**Search flow:**

```
UI → POST /api/leads/search
       → resolveSession()  (is there a session? resume?)
       → session lock
       → node services/scraper/run-google-maps.js  (stdin: JSON payload)
            → docker run gosom/google-maps-scraper
            → read results.json → JSON items
       → defensive merge (stdout ∪ file ∪ previous)
       → dedupe + quality filters + radius clipping
       → JSON → UI
```

---

## API

All endpoints are `POST` unless marked otherwise.

| Endpoint | What it does |
|---|---|
| `POST /api/leads/search` | Scrape. Body: `query`, `customKeyword`, `radiusKm`, `center`, `depth`, `lang`, `includeEmails`, `proxies`, `fresh` |
| `POST /api/leads/enrich` | Owner + emails + intent + local fact. Body: array of leads |
| `POST /api/leads/email-check` | DNS verification. Body: `emails[]` |
| `POST /api/leads/audit-website` | Audit. Body: `url` |
| `GET /api/leads/image` | Thumbnail proxy with a host whitelist |
| `GET /api/health` | Health check |

**Environment variables**: none. No `.env`, no keys, no tokens. Everything is
configured from the UI. If you ever add one, keep it in `.gitignore` (already
covered by `.env*`) and commit only an `.env.example`.

---

## What was done over the original repo

V2 starts from an earlier version and adds a lot. This is what **actually was
done**, with the evidence behind each decision:

### Audit of the upstream (`gosom/google-maps-scraper`)

The local version was audited against the upstream repo:

- **We are up to date**: the local image is **v1.18.1** (OCI revision
  `549e4b5e`, the tag's commit). The 3 later commits are docs and sponsors, with
  no functional changes.
- **Validated**: `-grid-bbox` + `-grid-cell` with `-depth 5` is the official
  pattern in the upstream examples.
- **Discarded after measurement** — the `gmaps-playwright-cache:/opt` volume
  from the official examples **adds nothing**: the image already ships 776 MB of
  browsers and "Downloading browsers" takes less than a second.
- **Discarded after measurement** — browser pool tuning
  (`-pages-per-browser 4 -browser-pool-size 2`) is **worse**: 3.175 GB of RAM
  and 387% CPU, against **896 MiB and 72%** with the defaults.
- **Implemented**: `-proxies-file` (security) and `-resume` (continue an
  interrupted run).

### Bug fixes

| Bug | Before | Now |
|---|---|---|
| Review count / rating | Read `rating` / `reviews` (always `undefined`) | Reads `review_rating` / `review_count` (the scraper's real names) |
| Cancelling a search | The container kept scraping in the background | Stopped by name (`docker stop`) |
| Export with non-Latin text | **pdf-lib crashed** and the whole PDF was lost | Sanitized to WinAnsi, the PDF always renders |
| Results with a changing `place_id` | Duplicates of the same branch | Dedupe by `name + city + domain` |
| PDF with photos | Different heights per photo | Unified size (46×46 pt) |
| Network fan-out | 200 simultaneous requests during enrich | Pool capped at 8 |
| Repeated DNS | 565 ms per lookup | 17 ms (TTL cache) |
| Maps query | Changed order vs the Maps UI | Removed the `near` suffix: the grid already places it |
| PDF in the initial bundle | 999.8 KB | 499 KB (pdf-lib and xlsx lazy-loaded) |

### What was added

Quality filters (reviews / rating / phone / website / chains), contacted-lead
suppression, heuristic owner finder, email waterfall with validation, intent
score, local fact + icebreaker + call script, real website audit, results /
calling / copy views, curated CRM export + PDF with photos + KML, a catalog of
475 Google types with predictive search, ES/EN i18n, light/dark mode, run
resumption and file-based proxies.

### How it is tested

There is no test framework (this is a scripts project), but there is a set of
real checks:

| What | How |
|---|---|
| Types | `npx tsc --noEmit` → 0 errors |
| Lint | `npx eslint .` → 0 errors |
| Build | `npx next build --webpack` |
| Scraper | `node --check services/scraper/src/run-google-maps.js` |
| Session / resume | Unit test for `lib/session-results.ts` (12 asserts, including "scraper truncates to 4 with 74 previous items") |
| Resume E2E | Interrupt the search → verify the partial file is on disk → resume → verify the accumulated count includes previous items |
| Concurrency | Two simultaneous POSTs with the same signature → the second must receive 409, not corrupt the first |
| Credentials | Search with a password-protected proxy → inspect the `docker.exe` command line → the password must not appear |

---

## How the repo was built

This project was developed with **AI agents** as co-authors, not in an empty
IDE. The real workflow:

1. **Context first** — the reference material (a Google Maps scraping course)
   was read and translated into a product model: a list is only useful if it has
   owner + email + a reason to contact.
2. **Audit before writing** — the upstream repo was audited and anything that
   added nothing (the browser volume, pool tuning) was **discarded after
   measurement**. Every decision kept its number.
3. **Layered implementation** — search → enrichment → verification → audit →
   export → performance → security. Each layer with its own verification.
4. **Real performance profiling** — bundle, fan-out and caching were measured
   and fixed with numbers, not intuition.
5. **Continuous documentation** — an internal `handoff.md` with state,
   decisions that must not be reverted and environment gotchas, so any session
   starts with full context.

**Models and tools used:**

| Tool | For |
|---|---|
| **Claude Code** (Opus / Sonnet) | Product design, large refactors, architecture |
| **Codex** | Type checks and code reviews |
| **opencode** (minimax-m3.1-flash) | Iterative implementation, debugging with probes, tests, documentation |
| **ripgrep / Node / PowerShell** | Search and editing (Node for text replacement: PowerShell breaks accents and CRLF) |

The `AGENTS.md` and `CLAUDE.md` files in the repo contain the rules agents follow
when working here.

---

## Performance (measured)

| Metric | Value |
|---|---|
| Initial bundle | **499 KB** (was 999.8 KB) |
| Network concurrency | 8 (was 200 simultaneous) |
| DNS: 1st lookup → 2nd | **565 ms → 17 ms** (1 h TTL cache) |
| Resume | Defensive merge: partial output is never lost |
| Build | `next build --webpack` compiles in ~2 s (warm) |

---

## Security

What this app does:

- **Proxies never go on the command line** (they go through a 0600 file +
  stdin), and logs redact them.
- **The proxy field is ephemeral**: not persisted, not exported, not uploaded to
  the repo.
- **Anti-SSRF whitelist** on the image proxy: Google hosts only.
- **The thumbnail proxy** does not act as an open proxy.
- **No secrets in the repo**: zero `.env`, zero API keys, zero tokens.
- **Double sanitization** in the PDF: character control + WinAnsi, so Arabic or
  Cyrillic text cannot break the export.

What it **does not** do (and you should know):

- **There is no authentication.** The app is meant to run locally. If you expose
  it to the internet, put an authenticating reverse proxy (Nginx basic auth,
  Cloudflare Access, Vercel with a password) **in front**.
- **There is no rate limiting** on the API.
- **Scraping Google Maps may violate Google's ToS.** See the next section.

---

## Ethics and limits

- Google Maps **prohibits automated scraping** in its Terms of Service. This
  tool is for **market research for your own purposes**, not for redistributing
  Google data or for mass load against its infrastructure.
- **Responsibility belongs to the user.** If you use it commercially, consider a
  licensed data provider (Google Places API, DataForSEO, LocalStack, etc.). The
  official API cost is usually smaller than the risk of getting blocked.
- **Do not use it for spam.** Email data is for one-to-one commercial contact
  with an easy opt-out. Follow your country's regulations (GDPR, LSSI, data
  protection laws, CAN-SPAM, CASL…).
- **Scraping third-party sites to extract emails** has its own gray area: respect
  `robots.txt` and do not hammer small sites.
- Place types come from the **official Google Places table** (Table A). Check
  the redistribution license before republishing the catalog.

---

## Troubleshooting

**The Search button does nothing / throws a Docker error**
Docker Desktop is not running. `docker info` tells you. The app still opens, but
without Docker there is no scrape.

**"A search is already running for this same query" (409)**
The previous run is still alive. Cancel it or wait. If the server restarted and
the lock was left behind, it releases itself.

**The search takes forever**
High `depth` + `-email` enabled is slow (measured: 62 places = 206 s with
`-email` vs ~30 s without). Lower `depth`, turn off the email flag (or run
**Enrich** afterwards, which does the same with caching), or split the radius
into quadrants.

**"Column X has no data"**
- `review_count` / `rating`: the scraper does not return them for every
  business. This is normal.
- `email`: many businesses do not have one, or the waterfall cannot find it.
- `owner`: it is heuristic. A match is not a certainty.

**The build fails with Turbopack**
Use `npx next build --webpack`. See the installation note.

**Windows antivirus blocks the scrape**
Windows Defender sometimes flags access to the Docker socket. Add an exclusion
for `node.exe` and for the Docker process.

---

## License and credits

**MIT** — see [LICENSE](LICENSE).

- Place types come from the **official Google Places table** (Table A).
- Scraping is done by
  [`gosom/google-maps-scraper`](https://github.com/gosom/google-maps-scraper)
  (MIT), which wraps Playwright.
- Maps: [Leaflet](https://leafletjs.com) + [OpenStreetMap](https://www.openstreetmap.org/copyright).
- Fonts: [Sora](https://fonts.google.com/specimen/Sora) +
  [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono).
- Export: [pdf-lib](https://pdf-lib.js.org) + [SheetJS](https://sheetjs.com).
