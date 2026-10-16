# Clutch

Соревновательная викторина с skill-мини-игрой. Русскоязычная mobile-first Telegram Mini
App (работает и в обычном браузере) с асинхронными соперниками: правильный ответ даёт
попытку в мини-игре, качество попытки даёт прогресс. Основной режим — **соло-забег до 100%
в своём темпе**: запись другого игрока (или бот) показана на полосе, но забег не завершает;
забеги сравниваются по числу кругов, нормированному на сложность набора. Продукт и правила —
[docs/PRODUCT.md](docs/PRODUCT.md).

Статус: играбельный прототип, **не готов к production**. Деплой ни разу не делался, на
телефоне в Telegram игра не проверялась — актуальная картина в [CONTEXT.md](CONTEXT.md).

## Стек

React + Vite (Cloudflare Pages) · Hono на Cloudflare Workers · Cloudflare D1 (SQLite) ·
TypeScript · npm workspaces.

```text
clutch/
├── apps/web/         React + Vite (Mini App и браузер)
├── apps/api/         Hono на Workers, миграции D1
├── packages/shared/  типы, правила, генераторы вопросов, пакет «Общих знаний»
├── content/          JSON-пакет вопросов
├── docs/             продукт, архитектура, план, аудит, тестирование, релиз; archive/ — история
├── scripts/          smoke, preflight, калибровка, телеметрия, контент
└── tests/            API- и кросс-пакетные тесты (остальные лежат рядом с кодом)
```

## Запуск

Нужен Node.js **22.17.0** ([`.nvmrc`](.nvmrc)) и npm из этой версии (его же использует CI и
route-тесты на `node:sqlite`).

```bash
npm install
cp apps/api/.env.example apps/api/.dev.vars   # заполнить, см. ниже
npm exec --workspace @clutch/api -- wrangler d1 migrations apply clutch-db --local
npm run dev
```

Web: http://localhost:5173 · API: http://localhost:8787. Миграции применяйте заново после
каждого изменения схемы; без них первый же запрос падает с `no such table`.

### Переменные окружения

`apps/api/.dev.vars` (в Windows PowerShell копируйте через `Copy-Item`):

```text
TELEGRAM_BOT_TOKEN=токен_бота_из_BotFather
SESSION_SIGNING_SECRET=случайная_строка_не_короче_32_символов
```

`SESSION_SIGNING_SECRET` подписывает guest-сессии браузера; задавайте независимо в каждом
окружении и не используйте токен бота. Не коммитьте `.dev.vars*` и `.env*` (шаблоны
`.env.example` отслеживаются). Web-переменные — `apps/web/.env.example` (`VITE_API_URL` нужен
только если Pages и Worker на разных origin; `VITE_TELEGRAM_BOT_LINK` — ссылка бота для
шаринга «На глазок»; в проде задать). Вне Telegram токен бота почти не участвует.

`wrangler.toml` содержит dev-ресурсы: Rate Limiting binding `API_RATE_LIMITER` (30 запросов
за 60 с; ID должен быть уникален в аккаунте при деплое), D1 `clutch-db`, ссылку
`TELEGRAM_MINI_APP_LINK` для страницы шаринга, cron возврата приглашений. Production-значения
не берутся отсюда — см. [RELEASE](docs/RELEASE.md).

## Проверки

```bash
npm test                          # unit, route (SQLite) и web-тесты
npm run build                     # typecheck + сборка web
npm run test:smoke:local          # настоящий Wrangler на чистой D1
npm run test:preflight:production # fixture production-проверки
```

Telegram, туннель (Cloudflare Tunnel/ngrok), ручной прогон и частые проблемы —
[docs/TESTING.md](docs/TESTING.md). Деплой — [docs/RELEASE.md](docs/RELEASE.md).

## Документы

Порядок чтения для разработчика и агента — в [AGENTS.md](AGENTS.md); снимок состояния —
[CONTEXT.md](CONTEXT.md). Остальное по необходимости: [PRODUCT](docs/PRODUCT.md),
[ARCHITECTURE](docs/ARCHITECTURE.md), [ROADMAP](docs/ROADMAP.md), [AUDIT](docs/AUDIT.md),
[CONTENT_REVIEW](docs/CONTENT_REVIEW.md), [ART_DIRECTION](docs/ART_DIRECTION.md).

## Ассеты и благодарности

- Флаги: [flagcdn.com](https://flagcdn.com)
- Контуры стран: [djaiss/mapsicon](https://github.com/djaiss/mapsicon) (условие автора:
  указывать авторство, не перепродавать; раздаются через jsDelivr)
- Звуки: [Kenney](https://kenney.nl) UI Audio, Interface Sounds, Impact Sounds (CC0)
- Исторические флаги — скачаны с Wikimedia Commons; пофайловый учёт лицензий не ведётся
  (см. [CONTENT_REVIEW](docs/CONTENT_REVIEW.md))
