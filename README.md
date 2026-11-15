# SPACE RELICS — Abandoned but Not Forgotten

An interactive space museum: the existing Space Relics homepage and 3D explorers,
the Launch Lab mission game, and a backend that serves the relic archive and
stores the missions you fly.

## Requirements

**Node.js 22.5 or newer.** This is enforced in two places:

- `package.json` → `"engines": { "node": ">=22.5.0" }`
- `.nvmrc` → `22` (run `nvm use`)

`npm run dev` and `npm run build` also run `scripts/check-node.mjs`, which stops
with a clear message instead of a crash.

> Why 22.5? The mission database uses Node's built-in **`node:sqlite`** module,
> which does not exist on older runtimes. On Node 20 or earlier the API routes
> fail with `Cannot find module 'node:sqlite'` and the server would not start.

Nothing else is required — no native build tools, no external database, no
API keys.

## Run it locally

```bash
nvm use            # optional: picks Node 22 from .nvmrc
npm install
npm run dev        # http://localhost:3000
```

Production check:

```bash
npm run build
npm start
```

## Routes

| Route | What it is |
| --- | --- |
| `/` | Homepage (unchanged) |
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
| `npm run test:sim` | Existing rocket-rules tests (Launch Lab) |
| `npm run db:migrate` | Apply pending database migrations |
| `npm run db:rollback` | Undo the newest migration |

## Environment variables

All optional — see `.env.example`.

| Name | Default | Purpose |
| --- | --- | --- |
| `DATABASE_PATH` | `.data/space-relics.db` | SQLite file location |
| `NEXT_PUBLIC_API_BASE_URL` | `/api` | Only for a cross-origin frontend |
| `PORT` | `3000` | Dev/production port |

## API

`GET /api/health` · `GET /api/relics` (`?planet=moon|mars`, `?category=`, `?q=`)
· `GET /api/relics/:id` · `GET|POST /api/missions` · `GET /api/orbiters` ·
`GET /api/traverse` · `GET /api/rover-photos`

The relic dataset is the existing `public/space/planets/data/missions.json`
(NASA/USGS coordinates, 33 records). The database is created automatically on
first request and is git-ignored.

## Project layout

| Path | What it is |
| --- | --- |
| `app/` | Next.js routes, API handlers |
| `components/space/` | Homepage + shared shell + archive UI |
| `lib/` | API client, database, migrations, relic data, NASA proxy |
| `public/space/` | The existing Launch Lab + Planet Explorer apps, served as-is |
| `Lonch game/launch-lab/` | Original standalone game project (untouched) |
