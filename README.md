# SPACE RELICS — Abandoned but Not Forgotten

An interactive space museum: the Space Relics homepage and 3D explorers, the
Launch Lab mission game, and a backend that serves the relic archive and stores
the missions you fly.

## Requirements

| Where | Node version |
| --- | --- |
| Local development | **24** (`.nvmrc`, `nvm use`) |
| CI (GitHub Actions) | **24** (`node-version-file: .nvmrc`) |
| Vercel | **24.x** (from `engines`; pin it in the project settings too) |

`package.json` declares `"engines": { "node": "24.x" }`. That is a bounded
range on purpose: an open range such as `>=22.5.0` lets the platform move the
build to a future major version on its own, which is what produced Vercel's
"may automatically upgrade to a future major Node version" warning.
`npm run dev` and `npm run build` also run `scripts/check-node.mjs`, which stops
with a clear message instead of a crash on an unsupported runtime.

Package manager: **npm only** (`package-lock.json`). The old `pnpm-lock.yaml`
has been removed so there is a single source of truth.

## Run it locally

```bash
nvm use            # picks Node 24 from .nvmrc
npm install
cp .env.example .env.local   # then fill in DATABASE_URL
npm run db:migrate           # create the tables
npm run dev                  # http://localhost:3000
```

Production check:

```bash
npm run build
npm start
```

## Routes

| Route | What it is |
| --- | --- |
| `/` | Homepage (unchanged) with the ambient score + volume control |
| `/moon` | Planet Explorer — 3D Moon |
| `/mars` | Planet Explorer — 3D Mars |
| `/missions` | Relic archive + your mission log |
| `/game` | Launch Lab |

Navigation order is Home · Moon · Mars · Missions · About · Game (Game is last).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build (**enforces TypeScript**) |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:sim` | Rocket-rules tests (Launch Lab) |
| `npm run test:db` | PostgreSQL migration/SQL tests (in-memory PGlite, no credentials) |
| `npm run db:migrate` | Apply pending PostgreSQL migrations |
| `npm run db:status` | Show applied / pending migrations |
| `npm run db:rollback` | Undo the newest migration |
| `npm run db:export-sqlite` | Export legacy local SQLite missions to JSON |
| `npm run db:import` | Import that JSON into PostgreSQL |

## Environment variables

| Name | Required | Scope | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | **yes (production)** | server only | PostgreSQL (Neon) connection string |
| `APP_ORIGIN` | recommended | server only | Canonical origin, e.g. `https://space-relics.vercel.app` |
| `UPSTASH_REDIS_REST_URL` | recommended | server only | Shared rate-limit store |
| `UPSTASH_REDIS_REST_TOKEN` | recommended | server only | Shared rate-limit store |
| `NEXT_PUBLIC_API_BASE_URL` | no | public | Only for a cross-origin frontend |
| `PORT` | no | build/runtime | Dev/production port |
| `DATABASE_PATH` | no | CLI only | Legacy SQLite path for `db:export-sqlite` |

No secret is ever exposed to the browser. `DATABASE_URL` and the Upstash tokens
must never be renamed to `NEXT_PUBLIC_*`, committed, logged or returned by an
API. `.env*` is git-ignored.

## Storage — PostgreSQL on Vercel

Mission records live in managed PostgreSQL (Neon) reached through the Neon
serverless driver. Each query is a short HTTPS request, so nothing relies on a
connection or a file surviving an invocation. The previous `.data/space-relics.db`
SQLite file is no longer used by the app: Vercel's function filesystem is not
durable, so a file-backed store would silently lose data.

**Setup**

1. Create a project at <https://neon.tech> (or attach the Neon integration to
   the Vercel project).
2. Copy the **pooled** connection string.
3. Locally: put it in `.env.local` as `DATABASE_URL=...`.
4. Vercel: Project → Settings → Environment Variables → add `DATABASE_URL` for
   **Production** (with `APP_ORIGIN`), then redeploy.
5. Vercel **Preview** needs its own value: create a separate Neon branch (or
   database) for previews and set `DATABASE_URL` for the Preview scope to that
   branch's connection string. Never reuse the production string there — a
   preview build auto-applies pending migrations on its first request, so a
   shared database lets preview code change live data.
6. Run `npm run db:migrate` once against each database (the app also applies
   pending migrations on the first request of a cold start, so this is a
   convenience, not a requirement).

Local development is a third case: either put a local PostgreSQL `DATABASE_URL`
in `.env.local`, or leave it unset and the app uses the embedded PGlite database
under the git-ignored `.data/pglite`.

Schema (`lib/migrations.mjs`): `missions` (primary key `id`, plus `session_id`,
launch-site and rocket fields, `parts_json`, `created_at`) with an index on
`(session_id, created_at DESC)`, and a `schema_migrations` ledger. Every value is
bound as a query parameter — no SQL string concatenation.

**Migrating old local records (no silent loss)**

```bash
npm run db:export-sqlite          # reads .data/space-relics.db → .data/exports/missions-export.json
npm run db:import                 # inserts them into PostgreSQL
```

The export writes into the git-ignored `.data/exports/` directory by default
and refuses to overwrite an existing file unless `--force` is passed. Writing
outside that directory requires `--allow-outside`. The export contains anonymous
session identifiers, so treat it as confidential. The export preserves the full
launch-site name (`site_name`), mission id, session id, timestamps and every
other legacy field; the import uses the recorded name and only falls back to
the site id when the name is genuinely missing.

The import matches on the primary key (`ON CONFLICT (id) DO NOTHING`), so it can
be re-run without duplicating or overwriting anything. If the legacy file does
not exist the export simply reports that there is nothing to move.

### Rollback safety

`npm run db:rollback` runs the newest migration's `down` step, which is
**destructive** (it drops tables and columns). Against any database that is not
on this machine it is refused by default. To run it deliberately you need all
three of `--yes`, `--allow-production` and `--confirm=DELETE-DATA`, and the
plan (affected tables, current mission count) is printed first. Use
`--dry-run` to see the plan without changing anything. Prefer a new additive
migration instead of a rollback in production.

**Failure behaviour**: if the database is missing or unreachable, mission
routes answer `503 database_unavailable` with a fixed message; no driver text,
query, path or stack trace is returned. `/api/health` reports
`database.detail: "unavailable"` / `"not configured"`.

## API protection

### Rate limiting (`lib/rate-limit.ts`)

| Policy | Route | Limit |
| --- | --- | --- |
| `read` | `/api/relics`, `/api/relics/:id`, `/api/orbiters`, `/api/rover-photos`, `/api/traverse` | 120 req / 60 s / IP |
| `missionsRead` | `GET /api/missions` | 60 req / 60 s / IP |
| `missionsWrite` | `POST /api/missions` | 10 req / 60 s / IP |

- Shared enforcement uses **Upstash Redis** (sliding window) when
  `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set. Each check is
  a single atomic Upstash command, so separate function instances cannot race
  past the limit with independent reads and writes.
- Without those variables a bounded **in-memory** fixed window still applies,
  but it is per function instance — configure Upstash for deployment-wide
  protection. The fallback is deliberate and never fails fully open.
- When Redis is configured but unreachable, the limiter degrades to the
  in-memory fallback and `/api/health` reports `checks.rateLimit.mode` as
  `upstash-degraded` with `ok: false`. A memory-only deployment is reported as
  `memory` with `ok: false` only on hosted platforms (Vercel / Netlify /
  Cloudflare Pages); locally, `memory` is the expected default and does not fail
  the health check.
- **Client IP extraction** (in order of precedence, all set by the platform's
  edge and never trusted from arbitrary client headers): `x-real-ip`, then the
  last entry of `x-vercel-forwarded-for`, then the last entry of
  `x-forwarded-for`. The first entry of `x-forwarded-for` is attacker-controlled
  and is never used. When none are present (local dev) everything is bucketed
  under the constant `local`. Addresses are SHA-256 hashed before use.
- Exceeding a limit returns **HTTP 429** with `Retry-After` and
  `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`.
  Successful responses echo the same three headers.
- No account, key or registration is required — the API stays free and public.

## Content Security Policy (report-only)

`next.config.mjs` ships a `Content-Security-Policy-Report-Only` header so
violations are observed without blocking. The app depends on Three.js/WebGL,
NASA/JPL and Wikipedia imagery, Google fonts via `next/font`, Vercel Analytics,
Web Audio and inline styles, so enforcing a strict policy today would break
rendering. Before switching to an enforced `Content-Security-Policy`:

- collect reports from real traffic and add every required origin explicitly
  (no broad `https:` wildcards in `script-src`/`connect-src`);
- confirm Three.js/WebGL, NASA/JPL images, fonts and analytics still load;
- keep `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'` and HSTS.

The API routes carry their own strict `default-src 'none'` policy (enforced,
not report-only).

### Vercel setup (Upstash)

1. Create a Redis database at <https://console.upstash.com> (Regional, free
   tier is fine).
2. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. Vercel: Project → Settings → Environment Variables → add **both** variables
   to Production. They are server-only (never `NEXT_PUBLIC_`).
4. For Preview, add a separate Upstash database (its own URL and token) so
   preview deployments cannot spend the production rate-limit budget.
5. Redeploy. `/api/health` should then report `checks.rateLimit.mode: "upstash"`
   and `ok: true`.

Never print, commit or paste either token anywhere other than Vercel's secret
store.

### Public API

All read endpoints are public and CORS-enabled (`Access-Control-Allow-Origin: *`,
`GET`/`OPTIONS` only):

| Endpoint | Query parameters | Cache |
| --- | --- | --- |
| `GET /api/relics` | `planet=moon\|mars\|all`, `category=crewed\|rover\|sample-return\|lander`, `q=<text ≤80>`, `limit=1..200` | `max-age=60`, CDN `s-maxage=300` |
| `GET /api/relics/:id` | — | `max-age=60` |
| `GET /api/orbiters` | `body=moon\|mars` (required) | `max-age=300` |
| `GET /api/rover-photos` | `rover=m20\|msl` (required) | `max-age=900` |
| `GET /api/traverse` | `rover=m20\|msl` (required) | `max-age=3600` |
| `GET /api/health` | — | `no-store` |

Responses use `{ "data": ... }`; errors use
`{ "error": { "code": "...", "message": "..." } }`. Invalid parameters return
`400`.

### Mission endpoints (session-scoped, private)

| Endpoint | Notes |
| --- | --- |
| `GET /api/missions?limit=1..50` | Records for the caller's `sr_sid` cookie only. `Cache-Control: private, no-store`. |
| `POST /api/missions` | Requires an exact same-origin `Origin`, `Content-Type: application/json`, ≤ 8 KB body. |

- Session cookie `sr_sid`: `HttpOnly`, `SameSite=Lax`, `Secure` in production,
  30 days. No account, no personal data.
- No wildcard CORS on `/api/missions`; session records are never exposed to
  third-party origins and are never cached by a CDN.
- Cross-origin writes are rejected with `403 forbidden_origin` using exact
  origin comparison (protocol + host + port), optionally pinned by `APP_ORIGIN`.
- Request bodies are rejected before parsing when they exceed 8 KB (`413`), when
  the content type is wrong (`415`) or when the JSON is malformed (`400`);
  every mission field is then re-validated on the server (`422` with `issues`).

## Security headers

`next.config.mjs` sets `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: SAMEORIGIN` (same-origin iframes for the 3D apps),
a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and
`Strict-Transport-Security` in production.

A `Content-Security-Policy` ships in **report-only** mode. It allows what the
site actually uses — three.js/WebGL, NASA imagery, Google-hosted fonts via
`next/font`, Vercel Analytics, Web Audio and inline styles — so it can be
watched in the browser before being enforced. Do not switch it to enforcing
without checking the reports.

## Legacy submodule

`Lonch game/launch-lab` is a git submodule
(`https://github.com/nagraajm/launch-lab.git`, declared in `.gitmodules`). The
running app serves its own copy from `public/space/`, so the site works whether
or not the submodule is initialised; `npm run test:sim` reads the checked-out
files under that path, so run `git submodule update --init --recursive` after a
fresh clone.

## Project layout

| Path | What it is |
| --- | --- |
| `app/` | Next.js routes, API handlers |
| `components/space/` | Homepage, shell, archive, mission film, ambient score |
| `lib/` | API helpers, PostgreSQL access, migrations, rate limiting, NASA proxy |
| `public/space/` | Launch Lab + Planet Explorer apps, served as-is |
| `scripts/` | Node guard, migration CLI, legacy export/import |
| `Lonch game/launch-lab/` | Original standalone game (submodule) |
