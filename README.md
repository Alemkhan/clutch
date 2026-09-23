# Clutch

Competitive trivia game. Knowledge earns the attempt. Skill wins the game.

## Stack

- **Frontend:** React + Vite (Cloudflare Pages)
- **Backend:** Hono on Cloudflare Workers
- **Database:** Cloudflare D1 (SQLite)
- **Language:** TypeScript

## Structure

```
clutch/
├── apps/
│   ├── web/     # React + Vite (Mini App + Web)
│   └── api/     # Hono on Workers
├── packages/
│   └── shared/  # shared types, schemas
```

## Setup

```bash
npm install
npm exec --workspace @clutch/api -- wrangler d1 migrations apply clutch-db --local
npm run dev
```

Web: http://localhost:5173
API: http://localhost:8787

## Environment

Copy `apps/api/.env.example` to `apps/api/.dev.vars` and fill in:

```
TELEGRAM_BOT_TOKEN=your_token_here
```

Never commit `.dev.vars` or `.env`.

For a deployed web build, set `VITE_API_URL` to the public Worker URL. The web
app falls back to a local scripted opponent when the API is unavailable.

## Test inside Telegram locally

The Vite dev server proxies `/api` to the local Worker, so only one public URL
is needed:

```bash
# terminal 1: web + Worker + local D1
npm run dev

# terminal 2: public HTTPS URL for port 5173
npm run tunnel
```

Copy the HTTPS URL printed by ngrok, then open `@BotFather`:
`/mybots` → `@playclutch` → Bot Settings → Configure Mini App and use that
URL. Keep both terminals running while testing. Restarting ngrok may change the
URL.

Inside Telegram the client initializes the Mini App SDK, applies viewport safe
areas, and sends raw `initData` to the Worker. The Worker validates its HMAC
and expiry before using the Telegram user ID and display name. A normal browser
continues to use an anonymous local identity.

## Async matches

Clutch uses asynchronous opponents rather than live sockets. A completed run
stores its exact question set and per-round result in D1. A later player in the
same category receives that run as a ghost opponent and plays the same
questions. The scripted opponent seeds an empty pool.

API:

- `POST /api/async-matches` — create a run and find a ghost.
- `POST /api/async-matches/:id/complete` — validate and store its rounds.
- `GET /api/leaderboard?category=geography` — best completed runs.

## Assets & credits

- Flags: [flagcdn.com](https://flagcdn.com)
- Country outlines: [djaiss/mapsicon](https://github.com/djaiss/mapsicon) (free to use with credit, served via jsDelivr)
- Sound effects: [Kenney](https://kenney.nl) UI Audio, Interface Sounds, and Impact Sounds packs (CC0)
