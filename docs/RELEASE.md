# Первый выпуск Clutch в Cloudflare (runbook)

Пошаговый порядок первого production-выпуска: Workers + D1 + Pages + Telegram Mini App.
Команды — PowerShell из корня репозитория. Фактическое состояние первого выпуска записано
ниже и в разделе Release evidence.

**Статус 2026-10-22:** OAuth-авторизация подтверждена; созданы production D1
`clutch-prod` (`7d4de210-608e-40c1-96d5-26fa18ef475d`) и Direct Upload Pages-проект
`clutch-app` (`https://clutch-app-ct8.pages.dev`); D1 мигрирована 0001–0009. Production
preflight прошёл для API `https://clutch-api-prod.kettikteam-official.workers.dev`, оба
секрета установлены, Worker и Pages развёрнуты, remote smoke и GitHub Actions прошли.
BotFather и walkthrough на настоящем телефоне ещё не подтверждены; публичный запуск пока
закрыт. Облачные команды (`deploy`, `secret put`) запускает только владелец. Деплой ручной,
CI его не делает.
Локальная настройка и туннель — [README](../README.md) и [TESTING](TESTING.md).

## Стоп-условия

Не направлять публичный трафик, пока не выполнено всё ниже:

- `npm test`, `npm run test:smoke:local` и `npm run preflight:production` проходят на
  commit, который будет выпущен; GitHub Actions зелёный на том же commit.
- Утверждён набор категорий, контент вычитан ([CONTENT_REVIEW](CONTENT_REVIEW.md)).
- Решено (DEC-03), casual-статистика это таблица или защищённое соревнование. Сервер сам
  выводит оценку удара, но время ответа сообщает клиент, лимит 15 секунд не применяется,
  подобранный момент удара не исключён ([AUDIT](AUDIT.md) A06).
- Визуальный baseline утверждён владельцем (MVP, 2026-10-13); палитра v6 не выбрана.
- Пройден walkthrough из [TESTING](TESTING.md) на реальном телефоне в Telegram (шаг 10).
- Созданы **отдельные** production D1 и Rate Limiting namespace; dev-ID из
  `apps/api/wrangler.toml` не используются (preflight откажет).
- Заданы production `TELEGRAM_BOT_TOKEN` и независимый `SESSION_SIGNING_SECRET` (не токен бота).
- Назначен человек, который наблюдает первый запуск и может остановить трафик.
- **Production-бот — `@playclutchbot`** (подтверждено владельцем 2026-10-17). Обе ссылки шага 2:
  `https://t.me/playclutchbot?startapp`.

Бюджет: для закрытой проверки хватает Workers Free; перед TikTok-трафиком включить Workers
Paid ($5/мес), чтобы не упереться в суточные лимиты. Тарифы перепроверить:
[Workers](https://developers.cloudflare.com/workers/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/),
[Pages](https://developers.cloudflare.com/pages/functions/pricing/).

## 0. Вход в Cloudflare

```powershell
npx wrangler login
npx wrangler whoami
```

Убедитесь, что это нужный аккаунт. Если аккаунтов несколько, задайте
`$env:CLOUDFLARE_ACCOUNT_ID` для сессии (preflight вычищает его из своих дочерних процессов).

## 1. Создание ресурсов

**D1.** Из вывода возьмите `database_id`:

```powershell
npx wrangler d1 create clutch-prod
```

**Rate Limiting namespace.** Отдельного «create» нет: `namespace_id` — положительное целое,
которое вы выбираете сами; оно должно быть уникальным среди Rate Limiting-привязок аккаунта и
не равным dev-значению из `apps/api/wrangler.toml`. Возьмите, например, случайное 7-значное
число. Это следует из документации
[Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
и **не проверено на реальном аккаунте**; если deploy на шаге 6 откажет по `ratelimits`,
сверяйтесь с этой страницей. Лимит в конфиге: 30 запросов в 60 секунд.

**Pages project (Direct Upload).** Для первого выпуска проще Direct Upload: без привязки к
Git, build идёт локально с теми же `VITE_*`, что проверил preflight. Git integration можно
подключить позже, но Direct Upload и Git integration — разные проекты (существующий проект
не переключить), см. [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).

```powershell
npx wrangler pages project create <PAGES_PROJECT_NAME> --production-branch main
```

Pages URL будет `https://<PAGES_PROJECT_NAME>.pages.dev`. Worker URL имеет вид
`https://<имя Worker>.<ваш поддомен>.workers.dev`; поддомен виден в Dashboard (Workers & Pages)
и подтверждается после первого deploy.

## 2. Заполнить `release.env` и загрузить в сессию

```powershell
Copy-Item release.env.example release.env
notepad release.env
```

Файл `release.env` в `.gitignore`, не коммитить. В нём девять значений `CLUTCH_PRODUCTION_*`
и `CLUTCH_PAGES_PROJECT_NAME`, у каждого комментарий, откуда его взять. Секретов там нет.

Загрузка в текущую сессию PowerShell:

```powershell
Get-Content release.env | Where-Object { $_ -match '^\s*[A-Z0-9_]+=' } | ForEach-Object {
  $k, $v = $_ -split '=', 2
  Set-Item -Path "env:$($k.Trim())" -Value $v.Trim()
}
```

Согласованность: `CLUTCH_PRODUCTION_TELEGRAM_MINI_APP_LINK` (`https://t.me/<bot>?startapp`) и
`CLUTCH_PRODUCTION_TELEGRAM_BOT_LINK` (`https://t.me/<bot>?startapp` — открывает Mini App сразу; допустим и `https://t.me/<bot>`) должны называть одного бота,
иначе preflight откажет. `CLUTCH_PRODUCTION_PUBLIC_WEB_ORIGIN` — origin Pages без пути.

## 3. Проверки и генерация конфига

```powershell
node --version        # ожидается v22.17.0
npm ci
npm test
npm run test:smoke:local
npm run preflight:production
npm run preflight:production:write-config
git status --short
```

`apps/api/wrangler.toml` остаётся development-only. Preflight строит отдельный production
JSONC во временном каталоге из явных значений: свои D1 и Rate Limiting привязки, `vars`
(`ENVIRONMENT=production`, `TELEGRAM_MINI_APP_LINK`, `PUBLIC_WEB_ORIGIN`), `triggers.crons`
(читается из `wrangler.toml`: `*/15 * * * *`, отпускает просроченные реванши) и
`observability`. Затем он гоняет Worker `deploy --dry-run`, полный root build с
`VITE_API_URL` и `VITE_TELEGRAM_BOT_LINK` и проверяет, что оба значения попали в bundle. Он
откажется работать, если Worker name, D1 ID или namespace совпали с dev, вычищает cloud/app
secrets из окружения дочерних процессов, ничего не загружает и не меняет.

`:write-config` сохраняет тот же проверенный конфиг в
`apps/api/wrangler.production.generated.jsonc` (ignored; имена и ID ресурсов, без секретов).
Он не перезаписывает существующий файл: после любого изменения ресурсов удалите файл и
создайте заново. **Откройте файл и просмотрите:** имя Worker, `DB`, `API_RATE_LIMITER`,
`vars`, `triggers.crons`, `observability`.

## 4. Миграции D1

```powershell
npx wrangler d1 migrations list DB --remote --config apps/api/wrangler.production.generated.jsonc
npx wrangler d1 migrations apply DB --remote --config apps/api/wrangler.production.generated.jsonc
```

Первое применение — `CREATE TABLE`/`CREATE INDEX` и аддитивные `ALTER TABLE ADD COLUMN` на
пустой базе (`0001_schema.sql`, `0002`–`0006`). Cloudflare делает backup перед применением,
но это не план восстановления ([D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/)).
Применённые файлы не переписывать: любое изменение схемы после этого — новая migration. Для
будущих миграций, пересобирающих таблицы, заранее делайте резервную копию.

## 5. Секреты

Не писать в `release.env`, `.dev.vars`, tracked config. `wrangler secret put` на Worker,
которого ещё нет, предложит создать его; согласитесь (код зальёт шаг 6). Токен бота вводится
в интерактивный запрос, подписной секрет генерируется и сразу уходит в pipe:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN --config apps/api/wrangler.production.generated.jsonc
node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))" |
  npx wrangler secret put SESSION_SIGNING_SECRET --config apps/api/wrangler.production.generated.jsonc
```

`SESSION_SIGNING_SECRET` не равен токену бота, минимум 32 символа. Каждый `secret put`
сразу разворачивает новую версию Worker
([Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)).

## 6. Deploy Worker

```powershell
npx wrangler deploy --config apps/api/wrangler.production.generated.jsonc
```

Запишите Worker URL, deployment/version ID и commit hash. Worker URL должен совпасть с
`CLUTCH_PRODUCTION_API_URL`; если нет, исправьте `release.env`, перезагрузите, удалите
сгенерированный конфиг и повторите шаг 3 до deploy веба.

## 7. Web: build и deploy в Pages

Те же `VITE_*`, что проверил preflight. Пустой env-каталог не даёт `apps/web/.env`
подмешать dev-значения:

```powershell
$env:CLUTCH_VITE_ENV_DIR = (New-Item -ItemType Directory -Force "$env:TEMP\clutch-empty-env").FullName
$env:VITE_API_URL = $env:CLUTCH_PRODUCTION_API_URL
$env:VITE_TELEGRAM_BOT_LINK = $env:CLUTCH_PRODUCTION_TELEGRAM_BOT_LINK
npm run build
npx wrangler pages deploy apps/web/dist --project-name $env:CLUTCH_PAGES_PROJECT_NAME --branch main
Remove-Item Env:CLUTCH_VITE_ENV_DIR, Env:VITE_API_URL, Env:VITE_TELEGRAM_BOT_LINK
```

Сохраните Pages deployment URL. Откройте его в desktop- и mobile-браузере.

## 8. BotFather

В `@BotFather` для production-бота:

1. Menu Button: production Pages HTTPS URL.
2. Main Mini App (кнопка `Launch app` в профиле), если нужна.
3. Проверить `https://t.me/<bot>?startapp`.
4. Убедиться, что в Worker лежит токен именно этого бота.
5. Не оставлять ngrok/dev-URL.

[Telegram Mini Apps](https://core.telegram.org/bots/webapps).

## 9. Remote smoke (без записи)

```powershell
npm run smoke:remote -- https://<WORKER_URL> https://<PAGES_URL>
```

Только GET, с таймаутами. Проверяет `/api/health` и `/api/ready` (`status: ok`,
`environment: production`, `checks.d1: ok`), что `/` у Pages отдаёт html и что bundle
ссылается на этот Worker URL. Ненулевой код означает: трафик не открывать. 503 на `/api/ready`
значит нет binding или не применены migrations.

## 10. Ручной прогон на телефоне

Walkthrough из [TESTING](TESTING.md) на реальном телефоне в Telegram против production:
browser guest и Telegram-пользователь проходят solo-забег, после reload забег продолжается,
нет `401`, круги видны в D1; matchmaking с сохранённой записью; offline-повтор без дубля;
«На глазок» (один ответ, вскрытие); шаринг ведёт на production-бота; клавиатура, BackButton,
safe areas, background/return, звук (в том числе iPhone); в Workers Logs нет токена, raw
`initData`, session secret, полного Authorization. Тестовые строки не удалять, пока они
единственное доказательство; пометьте тестовые identity.

## 11. Наблюдение и репорты

Первые 30–60 минут: Worker requests/CPU и `5xx`; `401`, `429`, сбои start/completion; D1
rows read/written/storage; доля `player` против `bot`; доставка Telegram-сообщений по
структурным логам (`reasonCode`); жалобы на media, клавиатуру, safe areas, звук. Рекламный
трафик на старте ограничить; не запускать несколько TikTok-роликов, пока малый поток не
подтвердил сохранение и подбор записей.

Репорты и события (`question_reports`, `analytics_events`: `sound_failure`,
`answer_option_mismatch`, `answer_replay_conflict`) — выгрузить prod-базу через
`npm run reports:pull`, затем смотреть `npm run reports` / `npm run activity`. Команда
`reports:pull` делается отдельной задачей и на момент написания **может отсутствовать**;
без неё читайте таблицы через
`npx wrangler d1 execute DB --remote --command "<SELECT ...>" --config apps/api/wrangler.production.generated.jsonc`.

## Rollback

**Worker.** Сохраните ID заведомо рабочей версии заранее.

```powershell
npx wrangler rollback --config apps/api/wrangler.production.generated.jsonc
```

Rollback сразу меняет активную версию
([rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)).

**Pages.** Верните предыдущий успешный deployment в Dashboard либо заново опубликуйте
рабочий commit (шаг 7).

**D1.** Откат кода не откатывает базу. Не удалять production-базу и не переписывать
применённые migrations; оценить совместимость старого кода со схемой; предпочтительно
выпустить исправляющую forward migration; восстановление из backup/Time Travel — отдельное
аварийное решение. Worker rollback не чинит удалённые или несовместимо изменённые ресурсы.

## Ansible release automation (Linux/WSL)

Полный выпуск можно выполнить локальным Ansible control host на Linux или WSL. Native
Windows Ansible не поддерживается. Playbook работает только с `localhost`, запускает те же
проверки, читает только публичные production-настройки из ignored `release.env`, формирует
production Wrangler config, всегда показывает удалённый список D1 migrations, развёртывает
Worker и Pages Direct Upload, затем запускает read-only remote smoke. Cloudflare OAuth login
и production Worker secrets настраиваются отдельно; automation не создаёт, не копирует и не
меняет секреты.

Из корня репозитория в Linux/WSL, где доступны Node 22, npm и Ansible:

```sh
ANSIBLE_CONFIG=ops/ansible/ansible.cfg \
ansible-playbook -i ops/ansible/inventory.ini ops/ansible/release.yml \
  -e release_confirm_production=true -e release_confirm_ci=true
```

`release.env` должен находиться в корне репозитория. Команда проверит чистоту tracked-файлов,
ветку `main`, обновит `origin/main`, проверит совпадение с `HEAD` и запишет hash коммита.
`release_confirm_ci=true` — отдельное ручное подтверждение, что GitHub Actions прошёл именно
на этом commit; Ansible сам GitHub не опрашивает. Незатреканные файлы не блокируют выпуск.
`npm ci` пропускается по умолчанию; включите его через `-e release_npm_ci=true`. После
проверки списка migrations они применяются только при явном `-e release_apply_migrations=true`:

```sh
ANSIBLE_CONFIG=ops/ansible/ansible.cfg \
ansible-playbook -i ops/ansible/inventory.ini ops/ansible/release.yml \
  -e release_confirm_production=true -e release_confirm_ci=true \
  -e release_apply_migrations=true -e release_npm_ci=true
```

Перед регенерацией playbook проверяет, что `apps/api/wrangler.production.generated.jsonc`
игнорируется Git, и удаляет только этот точный generated-файл, поскольку штатный генератор
отказывается перезаписывать его. Временный пустой env-каталог используется для production web
build. Локальный отчёт каждого запуска сохраняется в ignored `ops/ansible/evidence/`; он не
переписывает этот раздел `Release evidence`. После выпуска владелец вручную проверяет
результат и дополняет evidence, а затем выполняет walkthrough на настоящем телефоне.

GitHub Actions CI запускается при push в `main` (и на pull request); он проверяет код,
но не выполняет production deploy.

## Release evidence

После выпуска сохраните:

```text
Git commit: f24d57eb5fc9166a543873654a375937e8d5ea47
GitHub Actions run: статус нового run не прочитан; локально 1173/1173, preflight и build прошли
Worker version/deployment ID: 73368a8d-18c8-420d-b3be-8e4f801a2f9b
Pages deployment URL: https://63a00c25.clutch-app-ct8.pages.dev
D1 migrations applied: 0001–0009, список неприменённых пуст; 10 вопросов «На глазок» загружены
Telegram bot username (подтверждено владельцем): @playclutchbot
Smoke tester/device/Telegram version: не выполнено, нужен настоящий телефон
npm run smoke:remote result: успешно — health, ready/D1, Pages, Worker URL в bundle
Smoke result (ручной): не выполнен
Known limitations: JS bundle 879 КБ (gzip 251 КБ); телефонный walkthrough после исправления не выполнен
Rollback target: Worker 2c164125-964d-4e9c-9582-698b557dab9d; Pages https://68a59512.clutch-app-ct8.pages.dev
```

Без этих данных релиз считается выполненным вручную, но не воспроизводимым.
