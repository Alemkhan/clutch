# Архитектура: как устроен текущий код

Сверено с кодом 2026-10-16 (коммит `cc61513`). Клиент и API используют общие правила из
`packages/shared`. Единственный режим матча — **соло-забег до 100%** (`solo-to-100-v2`) плюс
тренировка и дружеская дуэль. Режим гонки удалён (R12; снятые разделы —
[archive/ARCHITECTURE_RETIRED.md](archive/ARCHITECTURE_RETIRED.md)); Last Stand заморожен.

## Карта репозитория

```text
apps/web/                React 18 + Vite + Framer Motion + Telegram SDK
  src/main.tsx, AppBootstrap.tsx  один React-root, loading/timeout вокруг Telegram init
  src/App.tsx            экран по `phase`; системный Back через telegramBackButton
  src/app/               useGameState (навигация верхнего уровня), gameSession (phase и
                         безопасные переходы), bootstrap, launchIntent (startapp-параметры)
  src/platform/          api.ts (HTTP, Telegram/guest auth, таймаут 5 с), telegram.ts,
                         telegramBackButton.ts, analytics.ts (очередь в памяти), sounds.ts,
                         soundPreference.ts, accessibility.ts, share.ts
  src/ui/                BottomNav (4 раздела), ScreenHeader, SoundToggle, TimerBar
  src/features/
    solo/                основной цикл: SoloRun, useSoloRun (+ Start/Restore/Lifecycle),
                         soloRunFlow (чистые переходы), soloRoundDelivery (retry одного
                         идемпотентного запроса), soloRunStore (id и категория активного забега),
                         clientMatchRules (runtime-проверка ответов сервера), stages/*,
                         SoloResult, SoloHud, CategorySelect, RematchEntry, useFriendInvite
    round/               QuestionScreen, ResolutionScreen, MatchHud, OpenAnswerInput,
                         reportPanel — общие для соло и тренировки
    hammer/              HammerGame и его части (scene, lane, result, intro, motion, strike)
    home/, board/, tiebreaker/, wikiPath/, myRuns/, training/, profile/   экраны разделов
    lastStand/           замороженный режим (входа с главной нет)
  src/index.css          только список @import, порядок значим
  src/styles/            tokens.css, base.css, v2-shell.css, legacy-/v2-responsive.css
  public/{sprites,sfx,flags-historic,share}/
apps/api/                Hono на Cloudflare Workers + D1
  src/index.ts           сборка: CORS, registerXRoutes, cron `scheduled`
  src/env.ts             bindings
  src/auth/              guest (HMAC token), identity (Authorization → RequestIdentity),
                         telegram (подпись и срок initData), auth (выдача guest-сессии)
  src/http/              jsonBody (лимит по UTF-8 байтам), rateLimit, system (health/ready)
  src/solo/              soloRuns (маршруты), startSoloRun, soloRounds (answer/hammer),
                         finalizeSoloRun, soloLeaderboard, matchmaking, repository
                         (захват записи, пул), soloRepository (`BOARD_CTE`, таблица),
                         soloRoundsRepository, bots, validation, answerDiagnostics
  src/rematch/           friendInvites («Позвать друга»), rematch (реванш, согласие)
  src/notifications/     Telegram-сообщения (outbid.ts: результат записи, дуэль, реванш),
                         outOfTop.ts, expiry.ts (плановый возврат), repository
  src/{myRuns,profile,training,tiebreaker,wikiPath,telemetry,share,lastStand}/  фича = route + repository
  migrations/            0001_schema.sql + новые файлы; описание таблиц — комментарии в SQL
  wrangler.toml          Worker, D1, Rate Limiting, cron раз в 15 минут (dev-конфиг)
packages/shared/src/     типы и правила для клиента и API
  soloRun.ts, soloCompare.ts, hammerRules.ts, questionPricing.ts   правила забега, исход,
                         молоток (стадия, цель, скорость, зоны), `setPar`
  tiebreaker.ts          «На глазок»: множитель, ввод, resolveTiebreak, корзины
  telemetry.ts           allowlist событий и типы репортов
  questionGenerator.ts, countries.ts, historicFlags.ts, languages.ts, flagTraits.ts,
  fuzzyMatch.ts          генераторы географии/флагов/языков и сверка открытого ответа
  generalPack/, generalSet.ts, questionResolve.ts   пакет «Общих знаний» из content/*.json,
                         набор дня, восстановление вопроса по id (генераторы + `gp:`-id)
  dailyQuestionSet.ts    размеры наборов, банк дня, `dailyKey`, граница суток
  practice.ts, friendDuel.ts   версии `solo-practice-v1`/`solo-friend-v1`, уровни ботов
  lastStand.ts, narrowCategories.ts   замороженный режим
content/                 пакет вопросов (605 вопросов + 52 набора, 16 тем) — см. content/README
tests/                   API/route-тесты на реальной SQLite (`helpers/testD1.ts`)
                         + кросс-пакетные; остальные тесты лежат рядом с кодом
scripts/                 smoke-local, preflight-production (+lib), calibrate-pricing,
                         telemetry-view, tiebreaker-load, content/*, share-cards, screens
.github/workflows/ci.yml npm ci → npm test → smoke:local → preflight fixture (с build)
```

### Стили

Обычный CSS, один вход `apps/web/src/index.css` (его импортирует `main.tsx`) — только
`@import`. Файлы лежат рядом с фичами (`features/<name>/*.css`, `ui/*.css`), глобальные — в
`styles/`. Порядок импортов совпадает с прежним порядком правил в едином файле и определяет
каскад: не переставляй и не объединяй куски без визуальной проверки. `*.v2.css` —
переопределения раскладки v2, стоящие позже старой секции экрана; при работе над экраном их
сливают со старым куском. `cssDuplicates.test.ts` следит, что каждый `.css` подключён ровно
один раз, а селектор верхнего уровня на объединённом тексте объявлен один раз. CSS из
компонентов не импортируется: это сломало бы порядок.

## Основной сценарий

Клиент: `App → SoloRun → useSoloRun (React, сеть, retry) → soloRunFlow (чистые переходы)`,
`clientMatchRules` проверяет ответы сервера по shared. Сервер: `index → solo/soloRuns →
auth/identity → http/{rateLimit,jsonBody} → solo/{matchmaking,validation,repository…} →
shared/{soloRun,hammerRules}`. SQL живёт в `*Repository` (системный route держит только
фиксированный read-only probe readiness), правила — в shared. Новый профиль бота — в
`solo/bots.ts`; новый HTTP-сценарий — в папке своей фичи; переходы вопрос → разбор → удар →
итог меняются в `soloRunFlow`, а условия завершения и scoring — в shared.

Игрок проходит набор в своём темпе до 100% (`SOLO_TARGET_PROGRESS`), потолок кругов —
`SOLO_ROUND_CAP`. Запись соперника показана на полосе, но забег не завершает.
`solo_score = круги / пар набора` (`set_par` хранится в `match_runs`).

| Версия правил | Назначение |
| --- | --- |
| `solo-to-100-v2` | Зачётный забег: пул, таблица, реванш, уведомления |
| `solo-practice-v1` | Тренировка с ботом; вне зачёта, исход не хранится |
| `solo-friend-v1` | Дуэль по ссылке «Позвать друга»; вне зачёта |

**Покруговой протокол.** `POST /api/solo-runs` (старт; повторный старт продолжает
незаконченный забег пары игрок+категория), `POST /api/solo-runs/:id/answer`, `/hammer`,
`/abandon`, `GET /api/solo-runs/:id` (продолжение). Отказ идемпотентно закрывает забег,
незавершённый удар пишет как промах, а в дуэли сохраняет поражение. Вопрос уходит как
`PublicQuestion` без ответа.
Круг пишется в `solo_run_rounds` по ходу игры: верный ответ сразу, удар закрывает круг
условным `UPDATE … WHERE settled_at IS NULL`, повтор запроса получает сохранённый ответ;
конфликт порядка — 409, и клиент восстанавливает серверное состояние. Закрытая вкладка забег
не теряет: клиент хранит в localStorage id и категорию активного забега; явный выбор другой
категории имеет приоритет над восстановлением. При чтении старого забега `openSoloRun`
синхронизирует только media-поля с текущей канонической записью вопроса, не меняя сохранённые
текст, варианты и ответы.

**Подбор** (`solo/matchmaking.ts`): свободная запись на несыгранном наборе из банка дня,
иначе несыгранный набор с ботом, иначе любая свободная запись, иначе давнее всего сыгранный
набор. Запись достаётся одному: `claimRecord` — условный `UPDATE … WHERE claimed_by IS NULL`
(замена `SKIP LOCKED`). Пул берёт записи с незанятым или просроченным захватом и
`opponent_run_id IS NULL`. Захват живёт `CLAIM_IDLE_MS` (3 минуты) **молчания** от
последнего круга; перехват рвёт пару (`dropPace`, `pace_released`). Завершённый забег запись
не отпускает. «Мои партии» достают владельцу записи имя сыгравшего подзапросом `played_by`.

**Наборы.** `DAILY_SET_SIZES`: `general` и география — 20 вопросов и 12 наборов в банке дня,
`history` и `languages` — 18 и 6. Набор в `match_runs` определяет `question_set_id`
(`history` менять нельзя). «Общие знания» собирает `generalSet.ts`: 14 записей пакета
(окно `[i*14, i*14+14)` перемешанного по сиду `general:<дата>` пула, 168 записей за сутки без
повторов) + 6 генераторных вопросов; 4 пакетных — открытым вводом; набор детерминирован.
Вопрос про страну может встретиться и в «Общих знаниях», и в географии одного дня — принято
(общий ledger сломал бы детерминированность). Тренировка берёт собственный набор.

**Исход и «На глазок».** `compareSoloRuns` (shared, чистая): счёт → круги → прикидка →
ничья. Прикидка дня — `tiebreaker_questions` (по одному на `dailyKey`, обязательные
`source_url`/`as_of_date`, `card_prompt`, `explanation_json`) и `tiebreaker_answers`
(PK игрок+вопрос, множитель округлён до 4 знаков). `GET /api/tiebreaker/today`: нет вопроса
→ `question: null`; до ответа — id, формулировка, номер, `answersCount`; после — свой
множитель, ответ, источник, распределение, перцентиль от 10, разбор. `POST
/api/tiebreaker/answer`: множитель считает сервер; чужой день — 409 `not_todays_question`,
повтор — 409 `already_answered`; тело до 512 байт. В исход идут только `telegram:`; сутки
прикидки — `dailyKey(created_at)` каждого забега. `CompleteSoloRunResponse.tiebreak`
приходит, только когда исход решила прикидка. Загрузка пака — `npm run tiebreaker:load`.

**«Вики-путь».** Клиент получает статью только через Clutch API, повторно очищает HTML и
делает активными лишь ссылки из `allowedLinks`. Worker запрашивает русскую MediaWiki Parse
API с идентифицирующим `User-Agent`, ограничивает время и размер ответа, сохраняет в D1
только id зафиксированной ревизии и разрешённые ссылки. HTML этой точной ревизии загружается
по `oldid` и кэшируется на edge Worker, но в D1 не хранится. Перед переходом сервер проверяет,
что цель есть среди ссылок текущей ревизии. Один `wiki_path_runs` на игрока и игровые сутки; обновление клика
защищено условным `UPDATE`. Вкладка «Вики-путь» живёт на общем экране «Таблица дня», включает
только завершившие Telegram-аккаунты, сортирует по числу кликов и использует соревновенный
rank; время завершения лишь стабилизирует вывод. Финиш маршрута сразу открывает эту вкладку.

**Таблица дня.** `GET /api/solo-leaderboard`: лучший дошедший до цели забег каждого игрока
за игровые сутки, топ-50 по счёту, кругам и множителю прикидки (гость и не ответивший —
после ответивших); длительность не участвует; место — `RANK()` (1, 2, 2, 4). Строки
несут `rank`, отдельно приходит `you`: место, `placeAbove`, `roundsToNext`,
`outrankedByGuess`, `tiebreak` (`answered` / `not_answered` / `guest`). Один SQL на список,
своё место и верх таблицы — `BOARD_CTE` в `solo/soloRepository.ts`. Индекс
`idx_match_runs_solo_board`. Границу суток задаёт `DAY_BOUNDARY_OFFSET_MINUTES` (+5 ч).

**Уведомления** (Telegram, только `telegram:`-игроки, по умолчанию включены, в каждом
сообщении кнопка отписки; `PUT /api/notifications/outbid`):
- результат записи — владельцу записи, когда её сыграли (`notifySoloResult`; дружеская
  дуэль — `notifyDuelResult`); текст объясняет, если исход решила прикидка; приглашения
  реванша не создаёт;
- реванш — `POST /api/solo-runs/:id/rematch` создаёт одноразовое приглашение
  (`rematch_invites`, `INVITE_TTL_MS` 7 дней) и шлёт сообщение с кнопкой `rm_…`;
  `GET /api/rematch/:id` — данные приглашения; повтор возвращает то же приглашение;
- «выбили из десятки» (`outOfTop.ts`): снимок первой десятки категории до и после
  завершения зачётного забега до 100% и ответа «На глазок»; выпавший получает сообщение не
  чаще раза в игровые сутки (`top_ten_notices`, `INSERT … ON CONFLICT DO NOTHING` до
  отправки); отправка через `waitUntil`;
- cron раз в 15 минут (`wrangler.toml`) → `releaseExpiredRematchInvites` возвращает
  просроченные приглашения в пул.
Отдельная opt-in настройка `GET`/`PUT /api/notifications/daily` управляет общей ежедневной
сводкой «На глазок» + «Вики-путь». После 17:00 Алматы тот же cron берёт до 20 активных за
30 дней подписчиков за проход; `daily_notification_deliveries` с PK `(player_id, date_key)`
не допускает повторной отправки. Deep-link payload `daily_guess`/`daily_wiki` открывает
нужный экран, `daily_off` отключает только эту сводку. Блокировка бота также выключает её.
`SendResult` несёт ограниченный `reasonCode` и `httpStatus`, тело ответа Telegram наружу не
выносится; сбои пишутся структурным логом с correlation id.

**«Позвать друга»** — `POST /api/solo-runs/:id/invite`: открытое приглашение
(`OPEN_INVITE_TTL_MS` — сутки), запись автора резервируется на срок приглашения. Дуэль идёт
с `solo-friend-v1` вне зачёта; исход против записи автора считается и виден обоим.

**Тренировка.** `GET /api/training/mistakes`, `POST /api/training/questions`, `/check`:
вопросы и проверка доступны только по ошибкам из серверного журнала `player_mistakes`
(пишется при неверном круге соло) и только вне непройденной части активного забега;
всё прочее — одинаковый 404. Для вариантов клиент присылает текст выбранного.

**Профиль, репорты, события.** `GET /api/profile` — сводка по завершённым забегам текущей
`rules_version`. `POST /api/reports` (`question_reports`; жёсткие капы, лишнее — 400) и
`POST /api/events` (`analytics_events`; allowlist из `shared/telemetry.ts`, до 4 плоских
ключей) — fire-and-forget; в телеметрии нет raw initData и токенов. Диагностика
`answer_option_mismatch` (текст на кнопке не совпал с вариантом по id) и
`answer_replay_conflict` (повтор ответа на записанный круг с другим ответом) пишется сервером
из `solo/answerDiagnostics.ts` только как наблюдение — верность считается по `selectedAnswer`.

## API

| Маршрут | Назначение |
| --- | --- |
| `GET /`, `/api/health`, `/api/ready` | Метаданные; liveness без D1; readiness (D1 + схема `match_runs`, 503 без деталей) |
| `POST /api/auth/guest` | Выдать или продлить guest-сессию |
| `POST /api/solo-runs`, `…/:id/answer`, `…/:id/hammer`, `GET …/:id` | Старт, круг, удар, продолжение |
| `GET /api/solo-leaderboard` | Таблица дня |
| `POST /api/solo-runs/:id/invite`, `…/:id/rematch`, `GET /api/rematch/:id` | «Позвать друга», реванш |
| `GET`/`PUT /api/notifications/outbid`, `…/daily` | Настройки уведомлений |
| `GET /api/my-runs`, `GET /api/profile` | История (курсор), сводка |
| `GET /api/tiebreaker/today`, `POST /api/tiebreaker/answer` | «На глазок» |
| `GET /api/wiki-path/today`, `POST …/start`, `GET …/runs/:id`, `POST …/:id/click`, `GET …/board` | «Вики-путь» |
| `GET /api/training/mistakes`, `POST …/questions`, `…/check` | Отработка ошибок |
| `POST /api/reports`, `POST /api/events` | Репорт вопроса, события |
| `GET /api/share`, `GET /api/share/card.png` | OG-страница и картинка результата |
| `POST /api/last-stand/start`, `…/:runId/answer`, `GET …/leaderboard` | Last Stand (заморожен) |

Маршруты с identity проверяют её, затем отдельный rate-limit bucket по `playerId` (30 за 60
с; guest-выдача — по `CF-Connecting-IP` с локальным fallback). Превышение — 429 с
`Retry-After: 60`, недоступный binding — 503. Счётчики Cloudflare binding локальны для
точки присутствия, не глобальны. JSON-тело каждого изменяющего маршрута ограничено по
UTF-8 байтам; answer/hammer принимают ровно текущий индекс и id вопроса.

## Хранение

D1, схема — `apps/api/migrations/` (`0001_schema.sql` + новые файлы; комментарии в SQL
объясняют колонки и `CHECK`). Таблицы: `match_runs` (все режимы, кроме Last Stand; снимок
условий, claim/pace, `reached_target`, `set_par`, `solo_score`, `solo_outcome`),
`solo_run_rounds` (покруговые answer/hammer, измеренное сервером окно `answer_window_ms`,
момент удара `active_elapsed_ms`, выведенное расстояние), `player_mistakes`,
`player_notification_prefs`, `rematch_invites`, `last_stand_runs`, `question_reports`,
`analytics_events`, `tiebreaker_questions`, `tiebreaker_answers`, `top_ten_notices`,
`daily_notification_deliveries`,
`wiki_path_challenges`, `wiki_path_page_revisions`, `wiki_path_page_refs`,
`wiki_path_challenge_targets`, `wiki_path_runs`.
Строки удалённой гонки (`race-to-100-v3`) остались как legacy с NULL-условиями и в пул не
попадают. В браузере хранятся: guest token (7 дней, продлевается с тем же subject), имя,
id активного забега, настройка звука, флаг показа интро молотка; вопросы и ответы в
localStorage не копируются.

Конфиг мини-игры `CURRENT_HAMMER_MINI_GAME` и условия соло `CURRENT_SOLO_RUN_CONDITIONS` —
в shared; числа молотка (зоны, скорость, множители стадий, смещения цели) живут только в
`hammerRules.ts` и здесь не дублируются. Версия правил покрывает условия завершения, награды
и scoring: при их изменении её меняют. Config сериализуется в постоянном порядке и сравнивается
точно; несовместимые записи не выбираются как соперник. Уже записанный круг не
переоценивается.

## Границы доверия

- Solo routes требуют Telegram initData (`Authorization: tma`, проверка подписи и срока)
  либо подписанный guest token; `playerId` из тела не принимается; чужой и отсутствующий id
  одинаково дают 404. Guest token в localStorage — bearer-секрет, не аккаунт.
- До ответа API отдаёт только `PublicQuestion` (без `correctOptionId`, `correctAnswers`,
  explanation); верный ответ приходит вместе с вердиктом круга. Закреплено
  `tests/noAnswerLeak.test.ts` и `apps/web/src/noAnswerData.test.ts` (данных ответов нет в
  бандле).
- **Оценку удара считает сервер:** клиент присылает только `activeElapsedMs`; позицию
  маркера, расстояние и tier выводит общая `scoreHammerTap`. Время не может превышать окно
  круга больше чем на 5 с. Это **не** защита от подобранного момента (маркер периодичен).
- **Окно ответа мерит сервер**; `responseTimeMs` — заявление клиента, ответ с временем
  больше окна — 400 `impossible_timing`. **Лимит 15 секунд сервер не применяет** и нынешним
  протоколом применить не может (набор уходит клиенту целиком).
- Граница игровых суток одна для всех: `DAY_BOUNDARY_OFFSET_MINUTES` (+5 ч, полночь в
  Алматы) задаёт и набор дня (`dailyKey`), и окно таблицы.
- CORS общий; ограничение origins не заменяет авторизацию.

## Локальный запуск, CI, production-проверка

Команды, секреты, туннель — [README](../README.md) и [TESTING](TESTING.md). `npm run dev`
поднимает Vite :5173 и Wrangler :8787 (Vite проксирует `/api`). `scripts/smoke-local.mjs`
создаёт временный config и local D1, применяет миграции, запускает настоящий Wrangler и по
HTTP проверяет readiness, 401 без авторизации, bot → eligible A → точный ghost B и
canonical повтор; ничего не читает из `.dev.vars`. Tracked `apps/api/wrangler.toml` —
только development. `npm run preflight:production` принимает шесть `CLUTCH_PRODUCTION_*`
значений, отвергает повтор dev-ресурсов, создаёт production-config в temp, делает
`wrangler deploy --dry-run` и полный build с проверкой exact API URL; deploy, remote
миграции и секреты не трогает. Реальный выпуск — только вручную по [RELEASE](RELEASE.md).

## Направление изменений, не текущая реализация

- Небольшой контракт мини-игры: входной config и прогресс, выход — попытка; награду
  определяют правила матча. Не начинать универсальный движок
  ([GAMES](design/minigames/GAMES.md)).
- Для серверного лимита вопроса — отдача набора по одному вопросу (решение владельца,
  [AUDIT](AUDIT.md) A06).
- Для лиг — поиск выбросов по `active_elapsed_ms`.
