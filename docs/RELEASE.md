# Release checklist Clutch

Этот runbook описывает будущий production-выпуск Cloudflare Pages + Workers +
D1 + Telegram Mini App. Он не является подтверждением готового деплоя.

**Ни один шаг не выполнялся:** удалённые ресурсы, production secrets, BotFather-настройки и
production D1 не созданы и не проверены. Команды с `--remote`, deploy, создание ресурсов и
изменение BotFather выполняются только владельцем отдельно. Локальная настройка и туннель —
в [README](../README.md) и [TESTING](TESTING.md).

## 1. Жёсткие стоп-условия

Не направлять публичный трафик, пока не выполнено всё ниже:

- `npm test`, local HTTP smoke и `npm run preflight:production` проходят на
  checkpoint, который будет выпущен. Preflight включает полный root build.
- GitHub Actions прошёл на том же commit, а не только локально.
- Утверждён набор категорий и редакционно проверен публикуемый контент
  ([CONTENT_REVIEW](CONTENT_REVIEW.md)).
- Решено (DEC-03), является ли таблица casual-статистикой или защищённым соревнованием.
  Сервер сам выводит оценку удара, но время ответа сообщает клиент, лимит 15 секунд не
  применяется, подобранный момент удара не исключён ([AUDIT](AUDIT.md) A06).
- Визуальный baseline утверждён владельцем (MVP, 2026-10-13); палитра v6 не выбрана.
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
CLUTCH_PRODUCTION_WORKER_NAME=<...>
CLUTCH_PRODUCTION_D1_NAME=<...>
CLUTCH_PRODUCTION_D1_ID=<UUID>
CLUTCH_PRODUCTION_RATE_LIMIT_NAMESPACE_ID=<numeric ID>
CLUTCH_PRODUCTION_API_URL=https://<...>
CLUTCH_PAGES_PROJECT_NAME=<...>
WEB_PUBLIC_URL=https://<...>
TELEGRAM_BOT_USERNAME=<...>
```

Нужны также production-значения, которых нет в `CLUTCH_PRODUCTION_*`: `TELEGRAM_MINI_APP_LINK`
(ссылка `https://t.me/<бот>?startapp`, куда ведёт страница шаринга; сейчас в `wrangler.toml`
стоит dev-значение), `PUBLIC_WEB_ORIGIN` (origin web для абсолютного URL картинки шаринга) и
web-переменная `VITE_TELEGRAM_BOT_LINK` (ссылка бота для шаринга «На глазок»; без неё
шаринг ведёт на адрес страницы). **Сгенерированный preflight-config задаёт в `vars` только
`ENVIRONMENT = "production"`** — `TELEGRAM_MINI_APP_LINK` и `PUBLIC_WEB_ORIGIN` пока приходится
добавлять вручную (в config перед review либо через Dashboard); это известная неполнота.

Нужно создать:

1. Отдельную production D1.
2. Отдельный production Rate Limiting namespace ID.
3. Production Worker с отдельным временным Wrangler config.
4. Pages project.
5. Production Telegram bot либо явно подтверждённый существующий бот.

Production config должен явно содержать собственные bindings и
`ENVIRONMENT = "production"`; tracked development config не используется.

Не копируйте production secrets в `.dev.vars`. Не используйте Telegram bot token
как session signing secret.

## 4. Подготовка репозитория

Из чистой рабочей копии нужного commit:

```powershell
node --version
npm ci
npm test
npm run test:smoke:local
npm run preflight:production
git status --short
```

Перед preflight задайте шесть `CLUTCH_PRODUCTION_*` переменных из раздела 3 в
текущей защищённой shell-сессии. Ожидается Node `v22.17.0`, зелёные проверки и
отсутствие неожиданных файлов.
Локальная `.claude/` не является частью release artifact.

`apps/api/wrangler.toml` намеренно остаётся development-only. Preflight создаёт
отдельный полный Wrangler JSONC во временном каталоге только из явных production
значений и откажется работать, если Worker name, D1 ID или rate-limit namespace
совпадает с development. Он удаляет cloud/app secrets из child environment,
запускает только Worker `deploy --dry-run --outdir` и production web build,
проверяет bundle и exact API URL, затем удаляет temp.

Preflight не применяет migrations, не загружает Worker/Pages и не меняет secrets.
По умолчанию config остаётся только в temp. После успешного real preflight владелец
может явно сохранить тот же проверенный config:

```powershell
npm run preflight:production:write-config
```

Файл `apps/api/wrangler.production.generated.jsonc` ignored, содержит имена/ID
ресурсов, но не bot/session/cloud secrets. Команда использует fail-if-exists и
никогда его не перезаписывает; существующий файл нужно осознанно удалить и
пересоздать после любого изменения production resources. `--write-config`
запрещён в fixture mode. Root deploy aliases намеренно отсутствуют, а реальный
deploy выполняется только отдельными ручными командами ниже после review файла.

## 5. D1

### 5.1. До remote-изменений

Проверить список локальных миграций:

```powershell
Get-ChildItem apps/api/migrations
npm exec --workspace @clutch/api -- wrangler d1 migrations list DB --local
```

Применить миграции на свежей локальной базе и повторить полный test/build. Сейчас это
`0001_schema.sql` и аддитивные `0002`–`0005` (в том числе `ALTER TABLE ADD COLUMN`).

### 5.2. Remote production D1

Только после проверки production binding:

```powershell
npx wrangler d1 migrations list DB --remote --config apps/api/wrangler.production.generated.jsonc
```

Применение — отдельное подтверждаемое действие владельца:

```powershell
npx wrangler d1 migrations apply DB --remote --config apps/api/wrangler.production.generated.jsonc
```

Cloudflare создаёт backup перед применением migration и откатывает неуспешную
конкретную migration, но это не заменяет план восстановления данных:
[D1 migration commands](https://developers.cloudflare.com/d1/wrangler-commands/).

Первое применение — `CREATE TABLE`/`CREATE INDEX` и один `ADD COLUMN` на пустой базе:
пересборок таблиц нет (история была сжата в `0001_schema.sql`), копию делать не от чего.
Для последующих миграций, которые пересобирают таблицы (SQLite не умеет менять `CHECK`
через `ALTER`), заранее делайте резервную копию: применение идёт без транзакции.

Не переписывайте применённые SQL-файлы. Сжатие истории было допустимо ровно один раз —
пока на remote ничего не разворачивали. После первого применения любое изменение
схемы — новая migration.

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

До любых remote-действий:

```powershell
npm run preflight:production
```

Проверьте в выводе:

- правильное Worker name;
- production D1 binding `DB`;
- production Rate Limiting binding `API_RATE_LIMITER`;
- отсутствие secret values в логах;
- `ENVIRONMENT = production`.

### 6.3. Deploy

Default preflight-config удаляется и не может быть случайно задеплоен. Только
после явного `npm run preflight:production:write-config`, review сохранённого
файла, D1 migrations и dry-run:

```powershell
npx wrangler deploy --config apps/api/wrangler.production.generated.jsonc
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
3. Авторизованный `GET <WORKER_PUBLIC_URL>/api/solo-leaderboard?category=general`
   возвращает таблицу либо пустой список без `5xx`.
4. Pages открывается и обращается именно к production Worker.
5. Browser guest начинает solo-забег, проходит answer → разбор → hammer и после
   reload продолжает тот же серверный run.
6. Telegram-пользователь начинает solo без `401`, а его круги появляются в D1.
7. Игрок A создаёт ждущую запись; игрок B атомарно получает её один раз, а
   третий игрок не получает уже занятую пару.
8. Неподходящая/повреждённая запись не ломает matchmaking.
9. Offline answer/hammer показывает повтор, а после восстановления сети один
   круг записывается без дубля.
   - Если есть вопрос «На глазок» на сегодня: ответ принимается один раз, вскрытие
     показывает распределение.
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
- таблицы `analytics_events` и `question_reports` (события `sound_failure`,
  `answer_option_mismatch`, `answer_replay_conflict`, репорты вопросов; смотреть
  `npm run reports`/`activity` против нужной базы или SQL);
- доставку Telegram-сообщений по структурным логам (`reasonCode`);
- жалобы на media loading, клавиатуру, safe areas и звук.

На старте ограничьте рекламный трафик. Не запускайте сразу несколько TikTok
роликов, пока один небольшой поток не подтвердил сохранение и подбор записей соперников.

## 11. Rollback

### Worker

Cloudflare позволяет вернуть предыдущую Worker version через Dashboard или:

```powershell
npx wrangler rollback --config apps/api/wrangler.production.generated.jsonc
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
