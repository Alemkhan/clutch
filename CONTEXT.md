# Clutch — Context for AI Sessions

## What is Clutch

Competitive trivia game. Players answer multiple-choice questions, then use timing skill (Hammer the Nail mini-game) to convert correct answers into match progress. Race against opponent to 100%.

Tagline: "Knowledge earns the attempt. Skill wins the game."

Owner: Alemkhan (content creator, questions, video, TikTok). Friend joins later for dev.

## Stack

- TypeScript everywhere
- Frontend: React + Vite (apps/web)
- Backend: Hono on Cloudflare Workers (apps/api)
- Database: Cloudflare D1 (SQLite), database_id in wrangler.toml
- Shared types: packages/shared
- Monorepo: npm workspaces
- Telegram bot: @playclutch (token in apps/api/.dev.vars, NOT in git)
- Deploy target: Cloudflare (Pages + Workers + D1), not deployed yet

## Project location

`C:\Users\Alemkhan\JSProjects\clutch\`

## Milestones

- **A — Skeleton**: monorepo (web + api + shared), tooling, landing stub. Done, in the initial commit.
- **B — Core gameplay loop**: questions, timer, resolution, Hammer the Nail, scripted opponent, result. Done.
- **C — App shell**: home dashboard, category select, matchmaking, profile, local stats, scripted challenge match. Done (sprites are known debt — see NOT done).
- **D — Backend & release**: D1 schema/migrations, real matchmaking, deploy to Cloudflare, mobile QA. Not started.

## What is done (through Milestone C)

- Home dashboard: find match (→ category select → matchmaking), profile, challenge entry (replaced the original landing screen)
- 10 questions per match, auto-generated from 48 countries
- 4 MC question types: flag→country, country→capital, flag→capital, outline→country
- 3 open-ended types: type the capital, type the country (flag), type the country (outline) — fuzzy match with Levenshtein
- Timer: 15 sec countdown per question, "Time's up!" on expire
- Hammer mini-game: marker moves, tap to stop, scoring (perfect/great/good/weak/miss)
- Opponent (Alex): scripted, updates progress each round
- Win condition: first to 100% or highest after 10
- Progress bars: player (red) vs opponent (blue)
- Result screen: win/loss + stats + rematch
- Profile screen with local stats: wins/losses/ties, current + best streak in localStorage — `apps/web/src/lib/localStats.ts`
- Scripted challenge: "Robb Peters" match reconstructed from a real video's Q&A order and outcomes (right/wrong per question; timings are estimates) — `apps/web/src/lib/tournaments.ts` + `sampleData.ts`
- Sprites regenerated with real alpha transparency (the originals were flattened onto opaque black — fixed via Higgsfield generate_image + remove_background) — `apps/web/public/sprites/`
- Hammer mini-game redesigned: hammer swings and strikes a nail sunk into a wood log (depth scales with skill tier: perfect ≈ flush, miss ≈ barely dented), log shake + impact burst on hit — see `apps/web/src/components/HammerGame.tsx`
- Sound effects: clicks, timer ticks, timeout, correct/incorrect, hammer tap + strike-quality tone, match win/lose — see `apps/web/src/lib/sounds.ts`, files in `apps/web/public/sfx/` (Kenney CC0 packs; Higgsfield's audio tools only cover speech/game-pipeline SFX, not standalone sound effects)
- Country outlines sourced from mapsicon via jsDelivr CDN, rendered as inverted white silhouettes on the dark theme
- D1 database created and `database_id` wired into `wrangler.toml` (not yet used — see below)
- Analytics: match_started, answer_submitted, skill_attempt_started/completed, match_completed (console.log in dev, flush() ready for backend)
- Shared types in @clutch/shared: Question, Tournament, Opponent, Match, SkillResult, countries, questionGenerator, fuzzyMatch, generateFixedCapitalQuiz

## What is NOT done

- Vibration on mobile
- Share card on result screen
- More categories (only Geography now)
- Sprite rework: current sprites are poor quality (known debt, flagged 2026-09-09) — regenerate/replace before release; not blocking
- Deploy to Cloudflare
- D1 schema and migrations (id is wired up, but no tables/queries yet — API endpoints are stubs)
- Deep-link attribution
- Mobile QA
- Git: all work through Milestone C is committed (single coarse commit — acceptable for a solo project)

## Key files

- `packages/shared/src/index.ts` — types + exports
- `packages/shared/src/countries.ts` — 48 countries dataset, flagUrl(), outlineUrl()
- `packages/shared/src/questionGenerator.ts` — generates 10 questions per match
- `packages/shared/src/fuzzyMatch.ts` — Levenshtein + isAnswerCorrect
- `apps/web/src/App.tsx` — main component, renders phases
- `apps/web/src/lib/useGameState.ts` — game state machine (phases: home, profile, categories, matchmaking, question, resolution, hammer, result)
- `apps/web/src/lib/analytics.ts` — event tracking
- `apps/web/src/lib/sounds.ts` — sound effect manager (playSound, strikeSoundFor)
- `apps/web/src/lib/localStats.ts` — localStorage stats (wins/losses/ties/streaks)
- `apps/web/src/lib/tournaments.ts` + `sampleData.ts` — scripted challenge (Robb Peters) + shared sample data
- `apps/web/src/components/` — HomeDashboard, CategorySelect, Matchmaking, Profile, QuestionScreen, HammerGame, TimerBar, OpenAnswerInput, ProgressBars, ResolutionScreen, ResultScreen
- `apps/web/src/index.css` — all styles, dark theme, red primary
- `apps/web/public/sfx/` — sound effect files (Kenney CC0)
- `apps/web/public/sprites/` — visual sprites
- `apps/api/src/index.ts` — Hono API (health + tournaments endpoint stub)
- `apps/api/wrangler.toml` — Cloudflare config with D1 binding

## How to run

```bash
cd C:\Users\Alemkhan\JSProjects\clutch
npm run dev
```

Web: http://localhost:5173
API: http://localhost:8787

## Decisions made

- C# Jekpe Jek CRM abandoned (niche saturated in KZ: Umai CRM, Mobifitness)
- Clutch is the active project now
- Questions generated client-side from country dataset (not from D1)
- D1 reserved for match results/leaderboard later
- Open-ended answers use Levenshtein distance (tolerance = max(1, length/5))
- Timer: 15 seconds per question
- Open-ended ratio: ~30% of questions
- App shell built client-side first (sample data, localStorage stats) — backend only when needed (Milestone D)
- No deploy yet (waiting)

## Glossary (shared language)

- **Match** — one game: 10 questions, race to 100% progress against an opponent.
- **Progress** — percent 0–100. Correct answers earn a skill attempt; skill quality converts to progress. First to 100% wins, else highest after 10.
- **Hammer the Nail** — the mini-game: marker swings, player taps to stop it; hit quality sets nail depth.
- **Skill tier** — hit quality: perfect / great / good / weak / miss. Perfect ≈ nail flush, miss ≈ barely dented.
- **Resolution screen** — shown right after answering, before the hammer: reveals correct/incorrect + the correct answer.
- **Challenge** — scripted match against a reconstructed real-world quiz (currently "Robb Peters", from a video's Q&A order and outcomes).
- **Category** — question domain; only Geography exists today (48 countries, 7 question types).
- **Local stats** — wins/losses/ties/streaks in localStorage, shown in Profile.

## Separate context: Life diary

`C:\Users\Alemkhan\Documents\Life\` — personal diary with AGENTS.md instructions. Discovery notes for Jekpe Jek in `Цели/проекты/`. Read AGENTS.md first if working in that folder.
