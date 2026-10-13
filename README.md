# Clutch

Competitive trivia game with a skill mini-game.

Clutch is a Russian-language, mobile-first Telegram Mini App with asynchronous
opponents: a correct answer earns a skill attempt, and the quality of the attempt
earns progress. The main mode is a **solo run to 100% at your own pace**: a saved
run of another player (or a bot) is shown on the progress bar but cannot end your
run, and runs are compared by laps normalized to the difficulty of the question
set. It also runs in a regular browser. (The earlier slogan "Skill wins the game"
was retired: a playtest showed knowledge, not accuracy, decided the outcome. See
[Product](docs/PRODUCT.md), DEC-01.)

## Project context

Start with [CONTEXT.md](CONTEXT.md) for the current snapshot. Contributor/model
workflow lives in [AGENTS.md](AGENTS.md). Read only the detailed document needed
for the task:

- [Product and open decisions](docs/PRODUCT.md)
- [Architecture and data flow](docs/ARCHITECTURE.md)
- [Code audit and known risks](docs/AUDIT.md)
- [Small implementation tasks](docs/ROADMAP.md)
- [Art, animation, and audio brief](docs/ART_DIRECTION.md)
- [Local, browser, and Telegram testing guide](docs/TESTING.md)
- [Production release checklist](docs/RELEASE.md)
- [First playtest report](docs/PLAYTEST_01.md) (historical: measured under the old race rules)
- [Last Stand mode notes](docs/COLLISION_MODE.md)
- [Content review gate](docs/CONTENT_REVIEW.md)

Status as of 2026-10-12: playable prototype, not production-ready. The main mode
is now the solo run (`solo-to-100-v2`); training (`solo-practice-v1`), friend duels
by link (`solo-friend-v1`, outside the ranking), rematch invites, "My runs" and a
four-section bottom navigation exist. The old race (`race-to-100-v3`) remains in
code only for previously issued invites. **Known open issue:** correct answers are
sent to the client and country data ships in the browser bundle; a fix is in
progress and not done. The paragraph below describes the earlier race-era
hardening (as of 2026-10-01); it still applies to the shared infrastructure.

The API and
client share match transitions; the API enforces ghost eligibility and versioned
conditions (R1, migration 0002 required). Authenticated match ownership is in
place, R2b bounds match inputs and request frequency, R3 durably retries
completed results until a valid acknowledgement, and R4 makes matchmaking and
replay explicit and cancellable. R5a makes the hammer motion frame-rate
independent and aligns its visual zones with shared scoring. R5b derives the
15-second question timer from an absolute deadline and settles answer/timeout
through a one-shot gate. R5c adds a deterministic pressure curve: successful
hits narrow and shift the target under shared client/server rules. The hammer was
later made harder (narrower perfect zone, variable marker speed). Broader abuse
protection and final art still need work.
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

Use Node.js 22.17.0, pinned in [`.nvmrc`](.nvmrc), and npm from that Node
release. This is also the version used by CI and by the `node:sqlite` route
tests.

```bash
npm install
npm exec --workspace @clutch/api -- wrangler d1 migrations apply clutch-db --local
npm run dev
```

Web: http://localhost:5173
API: http://localhost:8787

After pulling schema changes, run the local migration command again before
starting the API (migrations 0001–0009 are applied locally; 0009 rebuilds the
invites table so an invite may have no recipient). Migration
`0002_match_conditions.sql` preserves existing runs, but does not admit legacy
records with unknown conditions to the opponent pool. Unfinished legacy matches
must be restarted; completed results are not recalculated.

## Checks

```bash
npm test
npm run test:smoke:local
npm run test:preflight:production
```

The root build includes workspace typechecks. API route tests use the actual SQL
migrations in isolated in-memory SQLite via Node's built-in `node:sqlite` module
(verified on Node 22.17.0). Its experimental warning on that version is expected.
They do not replace Cloudflare runtime smoke tests or on-device Telegram QA.
The tracked GitHub Actions workflow runs `npm ci`, unit/route tests, the local
Wrangler HTTP smoke, and the production preflight fixture on pushes to `master`
and pull requests. The fixture includes the full root build. It has not yet run
on GitHub in this repository, so local success does not prove the remote CI
gate. The workflow does not deploy, use remote resources, or access secrets.

## Environment

Copy `apps/api/.env.example` to `apps/api/.dev.vars` and fill in:

```
TELEGRAM_BOT_TOKEN=your_token_here
SESSION_SIGNING_SECRET=replace_with_at_least_32_random_characters
```

`SESSION_SIGNING_SECRET` signs browser guest sessions and must contain at least
32 characters. Configure it independently in every environment; do not reuse the
Telegram bot token.

Never commit `.dev.vars*` or `.env*`; tracked `.env.example` templates remain
available for local setup.

`wrangler.toml` also declares the native `API_RATE_LIMITER` binding at 30
requests per 60 seconds. Its numeric namespace ID must be unique in the target
Cloudflare account before deployment. Wrangler simulates this binding locally;
Cloudflare counters are local to each Cloudflare location, not globally exact.

For release preparation, `npm run preflight:production` requires six explicit
`CLUTCH_PRODUCTION_*` values documented in [RELEASE](docs/RELEASE.md). It creates
a temporary production-only Wrangler config, refuses reuse of the tracked
development Worker/D1/rate-limit resources, performs only Worker dry-run and a
web build with the exact API URL, then removes the config. Root deploy aliases
were removed: deployment and remote migrations remain deliberate manual runbook
actions. When the API is unavailable, the UI offers retry or explicit local
practice; practice results are not uploaded.

After a successful real preflight, the owner can explicitly persist the same
validated config with `npm run preflight:production:write-config`. It is
written once to ignored `apps/api/wrangler.production.generated.jsonc`, contains
resource names/IDs but no secrets, and is never overwritten. Review it before
manual release commands and regenerate it after any production resource change.

## Test inside Telegram locally

The Vite dev server proxies `/api` to the local Worker, so only one public URL
is needed:

```bash
# terminal 1: web + Worker + local D1
npm run dev

# terminal 2: public HTTPS URL for port 5173
npm run tunnel
```

Copy the HTTPS URL printed by the tunnel, then open `@BotFather`:
`/mybots` → `@playclutch` → Bot Settings → Configure Mini App and use that
URL. Keep both terminals running while testing. Restarting the tunnel may change
the URL.

`npm run tunnel` runs ngrok. On a free ngrok account the page is replaced by an
interstitial warning, and inside Telegram there is no way past it: the two
header workarounds it suggests cannot be applied to a WebView's own navigation.
Use Cloudflare Tunnel instead — free, no interstitial, and its domain is already
allowed:

```bash
cloudflared tunnel --url http://localhost:5173
```

Vite accepts `*.ngrok-free.app`, `*.ngrok-free.dev`, `*.ngrok.app`, `*.ngrok.io`
and `*.trycloudflare.com`; any other domain goes in `CLUTCH_DEV_ALLOWED_HOSTS`
(comma-separated) rather than into `vite.config.ts`. A host outside the list is
answered with "Blocked request", which looks like a broken tunnel.

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
Terminal 4xx responses remain visible and are not retried. Local runs
are labeled as practice and are excluded from confirmed online profile stats.
The queue covers completed payloads only; it does not restore a match in progress.

The text above describes the race path (`POST /api/async-matches`), kept for
previously issued invites. The current solo flow uses `POST /api/solo-runs`,
`POST /api/solo-runs/:id/complete` and `GET /api/solo-leaderboard`; see
[Architecture](docs/ARCHITECTURE.md).

API:

- `POST /api/auth/guest` — issue a signed browser guest session.
- `POST /api/solo-runs`, `POST /api/solo-runs/:id/complete` — start and store a solo run.
- `GET /api/solo-leaderboard` — daily solo board by `solo_score`.
- `POST /api/solo-runs/:id/invite` — open "invite a friend" link.
- `GET /api/rematch/:id`, `GET /api/my-runs` — rematch invite, run history.
- `POST /api/async-matches`, `POST /api/async-matches/:id/complete` — legacy race path.
- `GET /api/leaderboard?category=geography` — legacy race leaderboard.

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
