# Release checklist Clutch

Этот runbook описывает будущий production-выпуск Cloudflare Pages + Workers +
D1 + Telegram Mini App. Он не является подтверждением готового деплоя.

На 2026-10-02 удалённые ресурсы, production secrets, BotFather-настройки и
production D1 из этой рабочей копии не проверены. Команды с `--remote`, deploy,
создание ресурсов и изменение BotFather выполняются только владельцем отдельно.

## 1. Жёсткие стоп-условия

Не направлять публичный трафик, пока не выполнено всё ниже:

- `npm test` и `npm run build` проходят на checkpoint, который будет выпущен.
- GitHub Actions прошёл на том же commit, а не только локально.
- Утверждён набор категорий и редакционно проверен публикуемый контент.
- Утверждён визуальный baseline хотя бы основного flow и hammer mini-game.
- Выбрана политика новых question sets, повторов и совместимых ghosts.
- Решено, является ли leaderboard просто casual-статистикой или защищённым
  соревнованием. Текущий клиент сообщает серверу время и `skillDistance`.
- Выполнен walkthrough из [TESTING](TESTING.md) на реальном телефоне в Telegram.
- Созданы отдельные production D1 и Rate Limiting namespace. Development IDs из
  текущего `wrangler.toml` нельзя автоматически считать production-ресурсами.
- Подготовлены production Worker name/domain, Pages project и `VITE_API_URL`.
- Настроены production `TELEGRAM_BOT_TOKEN` и независимый
  `SESSION_SIGNING_SECRET` длиной минимум 32 символа.
- Назначен человек, который наблюдает первый запуск и может остановить трафик.

## 2. Рекомендуемый бюджет

- Разработка и закрытая проверка: Workers Free.
- Перед TikTok-трафиком: Workers Paid с минимальной стоимостью $5/месяц, чтобы
  не зависеть от жёстких суточных Free-лимитов.
- Pages static assets не требуют отдельной оплаты за запросы.
- После запуска отслеживать Worker requests/CPU, D1 rows read/written/storage,
  `429`, `5xx` и ошибки completion.

Актуальные тарифы всегда перепроверять перед запуском:

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Pages pricing](https://developers.cloudflare.com/pages/functions/pricing/)

## 3. Production-ресурсы

Запишите значения в закрытом password manager, а не в этот файл:

```text
CLOUDFLARE_ACCOUNT_ID=<...>
PRODUCTION_WORKER_NAME=<...>
PRODUCTION_D1_NAME=<...>
PRODUCTION_D1_ID=<...>
PRODUCTION_RATE_LIMIT_NAMESPACE_ID=<...>
PAGES_PROJECT_NAME=<...>
WORKER_PUBLIC_URL=https://<...>
WEB_PUBLIC_URL=https://<...>
TELEGRAM_BOT_USERNAME=<...>
```

Нужно создать:

1. Отдельную production D1.
2. Отдельный production Rate Limiting namespace ID.
3. Production Worker либо именованное Wrangler environment `production`.
4. Pages project.
5. Production Telegram bot либо явно подтверждённый существующий бот.

Wrangler environments создают отдельные Workers. Production environment должно
явно содержать собственные bindings и `ENVIRONMENT = "production"`:
[Cloudflare environments](https://developers.cloudflare.com/workers/wrangler/environments/).

Не копируйте production secrets в `.dev.vars`. Не используйте Telegram bot token
как session signing secret.

## 4. Подготовка репозитория

Из чистой рабочей копии нужного commit:

```powershell
node --version
npm ci
npm test
npm run build
git status --short
```

Ожидается Node `v22.17.0`, зелёные test/build и отсутствие неожиданных файлов.
Локальная `.claude/` не является частью release artifact.

Перед первым production deploy требуется отдельная задача, которая:

1. Добавит проверенную `[env.production]` конфигурацию Worker.
2. Вставит реальные production D1/rate-limit IDs без секретов.
3. Добавит безопасный web deploy либо настроит Pages Git integration.
4. Проверит Worker dry-run.

Сейчас корневой `deploy:web` ссылается на отсутствующий script web workspace и
не должен использоваться.

## 5. D1

### 5.1. До remote-изменений

Проверить список локальных миграций:

```powershell
Get-ChildItem apps/api/migrations
npm exec --workspace @clutch/api -- wrangler d1 migrations list DB --local
```

Проверить миграции на свежей локальной базе и повторить полный test/build.

### 5.2. Remote production D1

Только после проверки production binding:

```powershell
npm exec --workspace @clutch/api -- wrangler d1 migrations list DB --remote --env production
```

Применение — отдельное подтверждаемое действие владельца:

```powershell
npm exec --workspace @clutch/api -- wrangler d1 migrations apply DB --remote --env production
```

Cloudflare создаёт backup перед применением migration и откатывает неуспешную
конкретную migration, но это не заменяет план восстановления данных:
[D1 migration commands](https://developers.cloudflare.com/d1/wrangler-commands/).

Не переписывайте уже применённые SQL-файлы. Любое следующее изменение схемы —
новая migration.

## 6. Worker API

### 6.1. Secrets

До открытия трафика должны существовать:

- `TELEGRAM_BOT_TOKEN`;
- `SESSION_SIGNING_SECRET`.

Задавайте их через Cloudflare Dashboard либо Wrangler, не через tracked config.
Учтите: `wrangler secret put` создаёт и немедленно разворачивает новую Worker
version. Для staged deployment используйте versions flow:
[Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

### 6.2. Dry-run

После появления production config, но до upload:

```powershell
npm exec --workspace @clutch/api -- wrangler deploy --dry-run --env production
```

Проверьте в выводе:

- правильное Worker name;
- production D1 binding `DB`;
- production Rate Limiting binding `API_RATE_LIMITER`;
- отсутствие secret values в логах;
- `ENVIRONMENT = production`.

### 6.3. Deploy

Только после D1 migrations и dry-run:

```powershell
npm exec --workspace @clutch/api -- wrangler deploy --env production
```

Сохраните deployment/version ID и commit hash в release notes.

## 7. Web / Pages

Рекомендуемый для MVP вариант — Pages Git integration, чтобы production build
был связан с Git commit и CI. Для монорепозитория:

```text
Build command: npm run build --workspace @clutch/web
Build output: apps/web/dist
Root directory: repository root
Node version: 22.17.0
VITE_API_URL: production Worker public URL
```

Альтернатива — Direct Upload после локального build:

```powershell
$env:VITE_API_URL = "https://<PRODUCTION_WORKER_URL>"
npm run build --workspace @clutch/web
npx wrangler pages deploy apps/web/dist --project-name <PAGES_PROJECT_NAME>
```

Не запускайте команду с placeholder. Direct Upload и Git integration — разные
рабочие процессы; выберите один до создания Pages project:
[Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

После deploy откройте итоговый Pages URL напрямую в desktop/mobile browser.

## 8. Telegram

В `@BotFather` для production-бота:

1. Установить production Pages HTTPS URL как Menu Button.
2. Настроить Main Mini App, если нужна кнопка `Launch app` в профиле.
3. Проверить `https://t.me/<BOT_USERNAME>?startapp`.
4. Убедиться, что Worker использует token именно этого бота.
5. Не оставлять ngrok URL в production-настройках.

Официальная инструкция: [Telegram Mini Apps](https://core.telegram.org/bots/webapps).

## 9. Smoke после deploy

Выполнять в таком порядке:

1. `GET <WORKER_PUBLIC_URL>/api/health` возвращает `status: ok` и
   `environment: production`; это только liveness Worker без проверки D1.
2. `GET <WORKER_PUBLIC_URL>/api/ready` возвращает `status: ok`,
   `environment: production` и `checks.d1: ok`. Ответ 503 означает, что трафик
   направлять рано: проверить binding и применение текущих D1 migrations.
3. `GET <WORKER_PUBLIC_URL>/api/leaderboard?category=geography` не даёт `5xx`.
4. Pages открывается и обращается именно к production Worker.
5. Browser guest получает online-матч, завершает его и видит
   `Результат сохранён.`.
6. Telegram-пользователь получает матч без `401` и сохраняет completion.
7. Игрок A создаёт eligible-run; другой игрок B видит `Запись игрока` с тем же
   набором вопросов.
8. Неподходящая/повреждённая ghost-запись не ломает matchmaking.
9. Offline completion остаётся видимой и сохраняется после восстановления сети.
10. Проверены экранная клавиатура, BackButton, safe areas, background/return и
   звук на реальном телефоне.
11. В D1 появилась ожидаемая completed-запись без дубликата completion.
12. В Workers Logs нет token, raw `initData`, session secret или полного
    Authorization header.

Маршрут `/api/ready` реализован и проверен локально в R9c, но его production URL
не считается опубликованным или проверенным до фактического deploy и этого smoke.

После smoke не удаляйте тестовые строки вручную, если это единственное
доказательство end-to-end. Пометьте тестовые identity либо удалите их отдельной
осознанной операцией после сохранения release evidence.

## 10. Наблюдение первого трафика

Первые 30–60 минут после публикации отслеживать:

- Worker request count, CPU и `5xx`;
- `401`, `429`, start/completion failures;
- D1 rows read/written, storage и медленные queries;
- долю источников `player` против `bot`;
- `save_failed`, abandoned и retry exhaustion после появления реального
  analytics receiver;
- жалобы на media loading, клавиатуру, safe areas и звук.

На старте ограничьте рекламный трафик. Не запускайте сразу несколько TikTok
роликов, пока один небольшой поток не подтвердил сохранение и ghost reuse.

## 11. Rollback

### Worker

Cloudflare позволяет вернуть предыдущую Worker version через Dashboard или:

```powershell
npm exec --workspace @clutch/api -- wrangler rollback --env production
```

Rollback немедленно меняет активную версию. Сохраните ID заведомо рабочей версии:
[Workers rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

### Pages

Верните предыдущий успешный Pages deployment через Cloudflare Dashboard либо
повторно опубликуйте заведомо рабочий commit.

### D1

Не считать code rollback откатом базы. Если новая migration уже применена:

- не удаляйте production database;
- не переписывайте применённую migration;
- оцените совместимость старого кода с новой схемой;
- предпочтительно выпустите исправляющую forward migration;
- восстановление из backup/Time Travel выполнять отдельным аварийным решением.

Cloudflare отдельно предупреждает, что Worker rollback не исправляет удалённые
или несовместимо изменённые platform resources.

## 12. Release evidence

После выпуска сохраните:

```text
Git commit:
GitHub Actions run:
Worker version/deployment ID:
Pages deployment URL:
D1 migrations applied:
Telegram bot username:
Smoke tester/device/Telegram version:
Smoke result:
Known limitations:
Rollback target:
```

Без этих данных релиз считается выполненным вручную, но не воспроизводимым.
