# Clutch

Competitive trivia game. Knowledge earns the attempt. Skill wins the game.

Clutch is a Russian-language, mobile-first Telegram Mini App with asynchronous
opponents: knowledge earns a skill attempt, and its quality earns match progress.
It also runs in a regular browser.

## Project context

Start with [CONTEXT.md](CONTEXT.md) for the current snapshot. Contributor/model
workflow lives in [AGENTS.md](AGENTS.md). Read only the detailed document needed
for the task:

- [Product and open decisions](docs/PRODUCT.md)
- [Architecture and data flow](docs/ARCHITECTURE.md)
- [Code audit and known risks](docs/AUDIT.md)
- [Small implementation tasks](docs/ROADMAP.md)
- [Art, animation, and audio brief](docs/ART_DIRECTION.md)

Status as of 2026-10-01: playable prototype, not production-ready. The API and
client share match transitions; the API enforces ghost eligibility and versioned
conditions (R1, migration 0002 required). Authenticated match ownership is in
place, R2b bounds match inputs and request frequency, R3 durably retries
completed results until a valid acknowledgement, and R4 makes matchmaking and
replay explicit and cancellable. R5a makes the hammer motion frame-rate
independent and aligns its visual zones with shared scoring. Question timing,
broader abuse protection, and final art still need work.
The remote deployment state has not been verified by this repository audit.

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
│   └── shared/  # types, question data/generation, scoring
├── docs/        # product, architecture, audit, roadmap, art brief
└── tests/       # cross-workspace tests (shared also has colocated tests)
```

## Setup

```bash
npm install
npm exec --workspace @clutch/api -- wrangler d1 migrations apply clutch-db --local
npm run dev
```

Web: http://localhost:5173
API: http://localhost:8787

After pulling schema changes, run the local migration command again before
starting the API. Migration `0002_match_conditions.sql` preserves existing runs,
but does not admit legacy records with unknown conditions to the opponent pool.
Unfinished legacy matches must be restarted; completed results are not recalculated.

## Checks

```bash
npm test
npm run build
```

The root build includes workspace typechecks. API route tests use the actual SQL
migrations in isolated in-memory SQLite via Node's built-in `node:sqlite` module
(verified on Node 22.17.0). Its experimental warning on that version is expected.
They do not replace Cloudflare runtime smoke tests or on-device Telegram QA.

## Environment

Copy `apps/api/.env.example` to `apps/api/.dev.vars` and fill in:

```
TELEGRAM_BOT_TOKEN=your_token_here
SESSION_SIGNING_SECRET=replace_with_at_least_32_random_characters
```

`SESSION_SIGNING_SECRET` signs browser guest sessions and must contain at least
32 characters. Configure it independently in every environment; do not reuse the
Telegram bot token.

Never commit `.dev.vars` or `.env`.

`wrangler.toml` also declares the native `API_RATE_LIMITER` binding at 30
requests per 60 seconds. Its numeric namespace ID must be unique in the target
Cloudflare account before deployment. Wrangler simulates this binding locally;
Cloudflare counters are local to each Cloudflare location, not globally exact.

For a deployed web build, set `VITE_API_URL` to the public Worker URL. When the
API is unavailable, the UI explains the failure and offers retry or explicit
local practice; practice results are not uploaded. The root `deploy:web` script
currently points to a missing web workspace script; complete the release setup
before using it.

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

The tunnel exposes the local app and proxied API. Use it for controlled testing,
not as a public beta until the remaining release risks in the audit are addressed.

Inside Telegram the client initializes the Mini App SDK, applies viewport safe
areas, and sends raw `initData` in the `Authorization: tma` header. The Worker
validates its HMAC and expiry on start and completion before deriving the Telegram
user ID and display name. A normal browser obtains a signed anonymous guest
session. Both match routes derive identity from that header, and completion
returns the same 404 for a missing or foreign match.

## Async matches

Clutch uses asynchronous opponents rather than live sockets. A completed run
stores its exact question set and per-round result in D1. A later player in the
same category receives that run as a ghost opponent and plays the same
questions. The scripted opponent seeds an empty pool.
The API accepts only legally finished runs. A full question sequence or the
player's own 100% makes a run eligible; an early loss is saved but excluded from
the pool. Matching also requires the current rules version, mini-game, and config.
Each new run stores its exact opponent snapshot (including bots), so completion
does not depend on later edits to the source record. The client validates the
returned `conditions` and opponent transcript before starting, then uses the
same shared round transition as the API. Local scripts are normalized separately.
Saved response times are not replayed as a real-time opponent timeline.

Completed online matches are first stored in a versioned browser queue without
credentials. The client retries transient failures with bounded backoff (and
honors `Retry-After`), resumes the queue on app bootstrap and browser `online`,
and removes an entry only after a valid acknowledgement for the same match.
Terminal 4xx responses remain visible and are not retried. Local/challenge runs
are labeled as practice and are excluded from confirmed online profile stats.
The queue covers completed payloads only; it does not restore a match in progress.

API:

- `POST /api/auth/guest` — issue a signed browser guest session.
- `POST /api/async-matches` — create a run and find a ghost.
- `POST /api/async-matches/:id/complete` — validate and store its rounds.
- `GET /api/leaderboard?category=geography` — best completed runs.

The start and completion JSON bodies are capped at 1 KiB and 16 KiB. Completion
accepts 1–10 rounds with bounded question IDs, answers, and response times.
Guest session issuance, match start/completion, and leaderboard reads use
separate 30-per-minute rate-limit buckets keyed by verified player identity or,
for unauthenticated routes, `CF-Connecting-IP`. A limit returns 429 with
`Retry-After: 60`; a binding failure returns 503.

## Assets & credits

- Flags: [flagcdn.com](https://flagcdn.com)
- Country outlines: [djaiss/mapsicon](https://github.com/djaiss/mapsicon) (free to use with credit, served via jsDelivr)
- Sound effects: [Kenney](https://kenney.nl) UI Audio, Interface Sounds, and Impact Sounds packs (CC0)
