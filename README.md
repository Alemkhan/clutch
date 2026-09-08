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

## Assets & credits

- Flags: [flagcdn.com](https://flagcdn.com)
- Country outlines: [djaiss/mapsicon](https://github.com/djaiss/mapsicon) (free to use with credit, served via jsDelivr)
- Sound effects: [Kenney](https://kenney.nl) UI Audio, Interface Sounds, and Impact Sounds packs (CC0)
