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
- **D — Backend & release**: asynchronous ghost matchmaking, D1 persistence, Telegram auth, deploy, mobile QA. In progress.

## What is done

- Home dashboard: find match (→ category select → matchmaking), profile, challenge entry (replaced the original landing screen)
- Game is in Russian (questions, options, UI strings) — data bilingual (name/nameRu, capital/capitalRu); open answers accept both RU and EN spellings
- 3 categories live: География (197 entries, 7 question types), Исторические флаги (44 flags from Wikimedia Commons, each with a trivia fact on resolution), Языки (37 languages, "what language is this" by script/sample)
- Historical flag images are served locally from `apps/web/public/flags-historic/` (44 files, downloaded+verified from Commons; taiping is .jpg)
- 10 questions per match, auto-generated from 197 country entries
- 4 MC question types: flag→country, country→capital, flag→capital, outline→country
- 3 open-ended types: type the capital, type the country (flag), type the country (outline) — fuzzy match with Levenshtein
- Timer: 15 sec countdown per question, "Time's up!" on expire
- Hammer mini-game: marker moves, tap to stop, scoring (perfect/great/good/weak/miss)
- Opponent (Alex): scripted, updates progress each round
- Win condition: first to 100% or highest after 10
- Match progress is tracked independently for player and opponent and rendered through a compact, game-agnostic Match HUD with identities, percentages, round count, and animated progress bars.
- Result screen: win/loss + stats + rematch
- Profile screen with local stats: wins/losses/ties, current + best streak in localStorage — `apps/web/src/lib/localStats.ts`
- Scripted challenge: "Robb Peters" match reconstructed from a real video's Q&A order and outcomes (right/wrong per question; timings are estimates) — `apps/web/src/lib/tournaments.ts` + `sampleData.ts`
- Current sprites have real alpha transparency, but their art direction and production quality are not accepted. Treat everything in `apps/web/public/sprites/` as temporary prototype material.
- Hammer mini-game prototype: hammer swings and strikes a nail sunk into a wood log (depth scales with skill tier: perfect ≈ flush, miss ≈ barely dented), with log shake and impact burst — see `apps/web/src/components/HammerGame.tsx`. Its concept may remain, but its sprites, composition, and animation need a full production pass.
- Sound effects: clicks, timer ticks, timeout, correct/incorrect, hammer tap + strike-quality tone, match win/lose — see `apps/web/src/lib/sounds.ts`, files in `apps/web/public/sfx/` (Kenney CC0 packs; Higgsfield's audio tools only cover speech/game-pipeline SFX, not standalone sound effects)
- Country outlines sourced from mapsicon via jsDelivr CDN, rendered as inverted white silhouettes on the dark theme
- D1 database created, `database_id` wired into `wrangler.toml`, and the async-match flow exercised locally
- Analytics: match_started, answer_submitted, skill_attempt_started/completed, match_completed (console.log in dev, flush() ready for backend)
- Async matchmaking foundation: completed runs are stored in D1 and replayed later as ghost opponents on the exact same question set; scripted Alex is the empty-pool/offline fallback
- D1 migration for match runs plus start/complete/leaderboard API routes
- Web records answer timing and hammer distance per round and submits completed async runs
- Unit tests cover skill thresholds, fuzzy answers, and match-generator invariants
- Telegram Mini App SDK initialization, viewport safe areas, and backend HMAC/expiry validation for initData
- Local Telegram testing uses one ngrok URL to Vite; Vite proxies /api to the local Worker/D1
- Shared types in @clutch/shared: Question, Tournament, Opponent, Match, SkillResult, countries, questionGenerator, fuzzyMatch, generateFixedCapitalQuiz

## What is NOT done

- Vibration on mobile
- Share card on result screen
- Visual production pass: current sprites and animations are placeholder-quality and explicitly rejected for release. Regenerate a coherent sprite set and rebuild the important motion/feedback before visual QA
- Image generation provider/workflow is intentionally undecided. Alemkhan plans to connect Higgsfield, Midjourney, or DALL-E in the next session and choose based on useful output quality
- Animation production pass: improve screen transitions, impact anticipation/contact/follow-through, progress feedback, and win/loss moments after the final art direction is selected
- Deploy to Cloudflare
- Apply D1 migrations to production and deploy the Worker/Pages app
- Telegram production configuration in BotFather and deploy-time Worker/Pages URLs
- Match pool/rating tuning, retries for failed completion uploads, and production observability
- Deep-link attribution
- On-device Telegram mobile QA (browser checks at 390x844 and 360x640 are not sufficient)
- Git: current Milestone C/D worktree still needs an intentional review and commit

## Key files

- `packages/shared/src/index.ts` — types + exports
- `packages/shared/src/countries.ts` — 197 country/territory entries (bilingual), flagUrl(), outlineUrl()
- `packages/shared/src/historicFlags.ts` — 44 historical flags (labels, eras, trivia facts), local files
- `packages/shared/src/languages.ts` — 37 languages with samples + facts
- `packages/shared/src/questionGenerator.ts` — generates 10 questions per match, per category (geography | history | languages)
- `packages/shared/src/flagTraits.ts` — auto-generated flag color/orientation traits (from flagcdn images) powering flag distractor similarity
- `packages/shared/src/fuzzyMatch.ts` — Levenshtein + isAnswerCorrect
- `apps/web/src/App.tsx` — main component, renders phases
- `apps/web/src/lib/useGameState.ts` — game state machine (phases: home, profile, categories, matchmaking, question, resolution, hammer, result)
- `apps/web/src/lib/analytics.ts` — event tracking
- `apps/web/src/lib/sounds.ts` — sound effect manager (playSound, strikeSoundFor)
- `apps/web/src/lib/localStats.ts` — localStorage stats (wins/losses/ties/streaks)
- `apps/web/src/lib/tournaments.ts` + `sampleData.ts` — scripted challenge (Robb Peters) + shared sample data
- `apps/web/src/components/` — HomeDashboard, CategorySelect, Matchmaking, Profile, QuestionScreen, HammerGame, TimerBar, OpenAnswerInput, MatchHud, ResolutionScreen, ResultScreen
- `apps/web/src/index.css` — all styles, light parchment theme, red primary, Telegram viewport/safe-area handling, mobile breakpoints
- `apps/web/public/sfx/` — sound effect files (Kenney CC0)
- `apps/web/public/sprites/` — visual sprites
- `apps/api/src/index.ts` — Hono API (health, async match start/complete, leaderboard)
- `apps/api/migrations/0001_async_matches.sql` — D1 schema for asynchronous match runs
- `apps/web/src/lib/api.ts` — async-match API client with offline fallback
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
- Questions/UI in Russian for the TikTok audience; data bilingual, open answers accept RU + EN
- Historical flags stored locally (public/flags-historic/) — no hotlinking to Wikimedia
- Countries without mapsicon outlines (xk, ps, mh, fm, tv) never appear as outline media (OUTLINE_EXCLUDED in questionGenerator)
- Distractors are confusable, not random: flags by color/stripe similarity (FLAG_TRAITS, top-6 shortlist shuffle), outlines island-vs-island + same region, capitals same region, languages same script; near-identical flag pairs (id/mc, ro/td) never distract each other
- Matchmaking is asynchronous, not live: a player's completed run becomes a ghost opponent for a later player in the same category
- Ghost opponents replay the exact same questions, timing, correctness, and hammer progress; D1 stores runs/results and no WebSockets are needed
- Match UI and mini-game UI are separate systems. Question screens must use a compact universal Match HUD (player/opponent identity, percentage, progress bars) with no hammer, nail, dartboard, or other game-specific art.
- Each skill mini-game owns its own visual metaphor and animation. Hammer the Nail shows the player's nail progress only inside `HammerGame`; a future darts game owns its dartboard visuals without requiring changes to the Match HUD.
- Skill mini-games should communicate with the match state through a small game-agnostic result contract (skill result/score plus awarded progress), rather than leaking their visuals into shared screens.
- The current shared stump/nails progress card is not the intended design. Do not polish or preserve it; replace it.
- Current visual assets and animation timings are disposable prototypes. Do not use them as a style reference for newly generated art. Establish a coherent art direction first, then regenerate the set consistently with the selected provider.
- Open-ended answers use Levenshtein distance (tolerance = max(1, length/5))
- Timer: 15 seconds per question
- Open-ended ratio: ~30% of questions
- App shell built client-side first (sample data, localStorage stats) — backend only when needed (Milestone D)
- No deploy yet (waiting)

## Next visual/design session

The next session is a visual reset, not a cleanup pass on the current sprites.

1. Connect and test one or more image-generation providers: Higgsfield, Midjourney, or DALL-E.
2. Define a small art-direction sheet before generating production assets: palette, outlines, lighting, perspective, texture, character proportions, transparency, and target sprite dimensions.
3. Generate one complete vertical slice first (home hero + hammer/nail/log + impact effects + result trophy) and validate it in Telegram on a real phone.
4. Once the style is accepted, generate the remaining assets as a consistent set; keep prompts/seeds/references or other reproducibility metadata where the provider allows it.
5. Keep the implemented universal `MatchHUD` independent from all mini-game art so future mini-games remain plug-in modules.
6. Rebuild motion around the accepted assets. Prioritize responsiveness and readable game feedback over decorative animation.

Release bar: the app should not ship with the current sprite set. The rejected shared stump/nails progress card was removed on 2026-09-24.

## Glossary (shared language)

- **Match** — one game: 10 questions, race to 100% progress against an opponent.
- **Progress** — game-agnostic percent 0–100. Correct answers earn a skill attempt; skill quality converts to progress. Shared screens visualize it with bars/percentages, not mini-game art. First to 100% wins, else highest after 10.
- **Match HUD** — compact shared match status shown around questions: player/opponent identity, percentages, and thin progress bars. It must work unchanged for Hammer the Nail, darts, and future mini-games.
- **Hammer the Nail** — one skill mini-game: marker swings, player taps to stop it, and hit quality sets the player's nail depth. Nail/log visuals appear only inside this mini-game.
- **Skill tier** — hit quality: perfect / great / good / weak / miss. Perfect ≈ nail flush, miss ≈ barely dented.
- **Resolution screen** — shown right after answering, before the hammer: reveals correct/incorrect + the correct answer.
- **Challenge** — scripted match against a reconstructed real-world quiz (currently "Robb Peters", from a video's Q&A order and outcomes).
- **Category** — question domain; Geography, Historical Flags, and Languages are playable.
- **Local stats** — wins/losses/ties/streaks in localStorage, shown in Profile.

## Separate context: Life diary

`C:\Users\Alemkhan\Documents\Life\` — personal diary with AGENTS.md instructions. Discovery notes for Jekpe Jek in `Цели/проекты/`. Read AGENTS.md first if working in that folder.
