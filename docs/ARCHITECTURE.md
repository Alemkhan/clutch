# Архитектура: как устроен текущий код

Основа: checkpoint `3015241` с R7c, 2026-10-02; обновлено 2026-10-12 под соло-режим.
API и клиент используют shared-правила; схема условий добавлена миграцией 0002,
соло-забеги, реванш и дружеские приглашения — миграциями 0003–0009 (применены локально).

Основной режим — **соло-забег до 100%** (`solo-to-100-v2`), а не гонка. Путь гонки
(`race-to-100-v3`, `POST /api/async-matches`) остаётся в коде ради ранее выданных
приглашений, входа с главной у него нет. Разделы «Карта репозитория» и «Поток
данных» ниже описывают оба пути; раздел «Соло-забег» — действующий.

## Карта репозитория

```text
apps/web/                      React 18 + Vite + Framer Motion + Telegram SDK
  src/AppBootstrap.tsx         loading/timeout/error вокруг Telegram init
  src/App.tsx                  переключение экранов по phase, Telegram Back
  src/lib/useGameState.ts       React/API/analytics orchestration
  src/lib/gameSession.ts        чистое состояние и переходы игровой сессии
  src/lib/clientMatchRules.ts   runtime-проверка условий и транскриптов R1c
  src/lib/api.ts                HTTP, Telegram/guest auth, timeout 5 секунд
  src/lib/completionQueue.ts    durable completion, ACK, retry/single-flight
  src/lib/telegram.ts           cached SDK/initData и фоновый viewport
  src/lib/telegramBackButton.ts чистая карта и lifecycle-контроллер BackButton
  src/lib/sampleData.ts         локальный соперник, генерация и config молотка
  src/lib/useSoloRun.ts, soloRunSession.ts, soloRunFlow.ts, soloResult.ts
                                основной цикл: забег, чистые переходы, итог
  src/lib/useFriendInvite.ts, friendDuelResult.ts  «Позвать друга», итог дуэли
  src/lib/trainingSession.ts, mistakeLog.ts, myRunsView.ts, launchIntent.ts
                                тренировка и отработка ошибок, «Мои партии»,
                                разбор startapp-ссылки (реванш/отписка)
  src/lib/useLastStand.ts, lastStandRun.ts, lastStandHook.ts  режим Last Stand
  src/lib/localStats.ts         localStorage: победы/поражения/серии
  src/lib/analytics.ts          очередь в памяти + dev console, без подключения
  src/lib/sounds.ts             воспроизведение текущих эффектов
  src/components/              вопросы, MatchHud/SoloHud, HammerGame, итоги, профиль,
                               BottomNav (четыре раздела), SoloRun/SoloResult,
                               TrainingHub/Training, MyRuns, RematchEntry, LastStand
  src/index.css                общие стили и более поздние V2-переопределения
  public/{sprites,sfx,flags-historic}/
apps/api/
  src/index.ts                 composition root: Hono, CORS, регистрация routes
  src/env.ts                   Cloudflare bindings
  src/auth/guest.ts            HMAC guest token: issue/verify/renewal subject
  src/auth/identity.ts         Authorization → единый RequestIdentity
  src/auth/telegram.ts         проверка подписи и срока Telegram initData
  src/http/jsonBody.ts         ограниченное по UTF-8 байтам чтение JSON
  src/http/rateLimit.ts        общий адаптер Cloudflare RateLimit и IP-ключ
  src/matches/bots.ts          BotProfile и фабрика снимка bot opponent
  src/matches/repository.ts    D1-запросы создания, подбора и завершения
  src/matches/validation.ts    HTTP-входы и проверка сохранённых snapshots
  src/matches/types.ts         внутренний тип строки match_runs
  src/routes/auth.ts           выдача/продление browser guest session
  src/routes/asyncMatches.ts   сценарии start/complete async-матча
  src/routes/leaderboard.ts    HTTP-маршрут leaderboard гонки
  src/routes/soloRuns.ts       старт/завершение соло-забега, таблица соло
  src/routes/friendInvites.ts  «Позвать друга»: создание открытого приглашения
  src/routes/rematch.ts        приглашение на реванш, согласие на уведомления
  src/routes/myRuns.ts         история прохождений игрока
  src/routes/share.ts          OG-страница и карточка результата
  src/routes/lastStand.ts      Last Stand: старт, ответ, таблица
  src/routes/system.ts         metadata, liveness/readiness
  src/matches/{matchmaking,scoring,soloRepository,historyRepository}.ts
                               подбор из банка наборов дня, оценка круга, D1 соло и истории
  src/notifications/           приглашения на реванш, Telegram-сообщения, плановый возврат просроченных
  src/lastStand/, src/share/   Last Stand и рендер карточки результата
  migrations/0001_async_matches.sql
  migrations/0002_match_conditions.sql  условия, снимок соперника, пригодность ghost
  migrations/0003_question_set_id.sql   идентификатор набора вопросов
  migrations/0004_last_stand.sql        таблица Last Stand
  migrations/0005_rematch_notifications.sql  согласие на уведомления, приглашения на реванш
  migrations/0006_rematch_invite_release.sql возврат просроченных приглашений
  migrations/0007_solo_runs.sql         reached_target, set_par, solo_score
  migrations/0008_solo_outcome.sql      исход забега, индекс таблицы соло
  migrations/0009_friend_invites.sql    приглашение без адресата (пересборка таблицы)
  wrangler.toml                Worker, D1, Rate Limiting binding и cron возврата приглашений
packages/shared/src/
  index.ts                     типы, versioned conditions и exports
  hammerRules.ts               pressure stage, target, thresholds, distance и scoring
  matchRules.ts                чистые правила раунда/матча и пригодности ghost
  matchRules.test.ts           детерминированные регрессии для этих правил
  questionGenerator.ts         сборка набора по категории
  countries.ts                 197 записей стран/территорий
  historicFlags.ts             44 записи («Другие флаги», id `history`); изображения локально в web
  languages.ts                 37 языков и примеры письма
  flagTraits.ts, fuzzyMatch.ts  похожие дистракторы и проверка открытого ответа
  soloRun.ts, soloCompare.ts   правила соло-забега и сравнение по solo_score
  practice.ts, friendDuel.ts   версии `solo-practice-v1` / `solo-friend-v1`, уровни ботов
  dailyQuestionSet.ts          покатегорийные размеры наборов и банк наборов дня
  narrowCategories.ts, lastStand.ts  Last Stand
  questionPricing.ts           оценка «цены» вопроса по формату
  questionBank.ts, showQuiz.ts  заготовки, не подключённые к основному циклу
tests/telegramAuth.test.ts      3 unit-теста initData
tests/botOpponent.test.ts       3 unit-теста профилей и фабрики бота
tests/guestAuth.test.ts         unit-тесты подписи и срока guest token
tests/identity.test.ts          разбор Telegram/guest Authorization
tests/asyncMatches.test.ts      route/SQL-тесты async conditions/completion
tests/requestLimits.test.ts      лимиты тела/полей и rate-limit маршрутов R2b
tests/helpers/testD1.ts         in-memory SQLite adapter для API-тестов
apps/web/src/lib/clientMatchRules.test.ts  13 клиентских тестов R1c
apps/web/src/lib/gameSession.test.ts       9 тестов чистых переходов сессии
apps/web/src/lib/api.test.ts               срок и renewal browser guest session
packages/shared/src/index.test.ts  15 unit-тестов shared
scripts/smoke-local.mjs            изолированный Wrangler/D1 HTTP smoke
scripts/preflight-production.mjs   production config → dry-run + exact web build
scripts/lib/production-preflight.mjs  чистая validation/config generation
.github/workflows/ci.yml           unit → local HTTP smoke → preflight fixture/build
```

## Как читать основной сценарий

Клиентский путь начинается в `App`, но правила переходов там не живут:

```text
App → useGameState (React, сеть, эффекты) → gameSession (чистые переходы)
                                      ↘ clientMatchRules → shared/matchRules
```

Серверный путь начинается с маленькой точки сборки. Доменные SQL-запросы матчей
остаются в repository; системный route содержит только фиксированный read-only
schema probe для readiness:

```text
index → routes/system → D1 readiness
     ├→ routes/auth → auth/guest
     ├→ routes/leaderboard → D1
     └→ routes/asyncMatches → auth/identity → auth/{telegram,guest}
                          ├→ http/{rateLimit,jsonBody}
                          ├→ matches/bots
                          ├→ matches/validation → shared/matchRules
                          └→ matches/repository → D1
```

Соло-путь (`routes/soloRuns`, `friendInvites`, `rematch`, `myRuns`) устроен так же:
SQL в `matches/*Repository` и `notifications/repository`, правила в shared.

Новый профиль бота добавляется в `matches/bots.ts`. Новый HTTP-сценарий — в
`routes`; SQL остаётся в `repository`. Переход вопрос → разбор → skill → итог
меняется и тестируется в `gameSession`, а общие условия победы — в shared.

## Соло-забег: действующий основной цикл

Игрок проходит набор вопросов в своём темпе до 100% прогресса. Запись соперника
(или бот) показывается на полосе, но завершить забег не может, поэтому забег не
обрывается, когда «соперник добрал». Результат — `solo_score = круги / пар набора`
(`set_par` хранится в `match_runs`): нормирует наборы разной сложности. Исход
против записи (`player` / `opponent` / `tie`, колонка `solo_outcome`) считает
`compareSoloRuns` в shared; тайминг — параметр функции, функция чистая.

| Версия правил | Назначение |
| --- | --- |
| `solo-to-100-v2` | Соревновательный забег: пул, таблица, приглашения, рейтинг |
| `solo-practice-v1` | Тренировка с ботом на уровне сложности; вне соревнования |
| `solo-friend-v1` | Дуэль по ссылке «Позвать друга»; вне соревнования |
| `race-to-100-v3` | Старая гонка; только для ранее выданных приглашений |

- **Старт и завершение:** `POST /api/solo-runs`, `POST /api/solo-runs/:id/answer`, `/hammer` (покруговая отправка), `GET /api/solo-runs/:id` (продолжение); `POST /api/training/questions`, `/check` (отработка ошибок);
  таблица за сутки — `GET /api/solo-leaderboard` (только дошедшие до цели, по
  категории и `solo_score`; индекс из миграции 0008).
- **Подбор:** `matches/matchmaking.ts` берёт свободную запись на несыгранном
  игроком наборе из банка дня, иначе несыгранный набор с ботом, иначе любую
  свободную запись, иначе давнее всего сыгранный набор. Если игрок прошёл все
  наборы дня, клиент может прямо сказать, что набор повторяется.
- **Размеры наборов:** `DAILY_SET_SIZES` — география 20 вопросов и 12 наборов в
  банке дня, `history` («Другие флаги») и `languages` по 18 и 6 наборов. Причина:
  у флагов 44 сущности, у языков 37 и по одному шаблону вопроса, тогда как в
  географии 197 стран на семь шаблонов. Набор в `match_runs` определяет
  `question_set_id` (миграция 0003), поэтому id `history` менять нельзя.
- **Реванш:** когда один забег обошёл чужой, создаётся одноразовое приглашение со
  сроком (`rematch_invites`); реванш идёт на новом наборе. Получатель открывает его
  по startapp-ссылке (`rm_…`), `GET /api/rematch/:id`. Согласие на уведомления —
  `/api/notifications/outbid` (по умолчанию включено, отписка в сообщении).
- **Возврат просроченных:** cron раз в 15 минут (`wrangler.toml`) вызывает
  `releaseExpiredRematchInvites`; просроченные неиспользованные приглашения
  получают `released_at`, а запись возвращается в общий подбор (миграция 0006).
- **«Позвать друга»:** `POST /api/solo-runs/:id/invite` создаёт открытое
  приглашение без адресата; его забирает первый открывший. Запись пригласившего
  резервируется на срок приглашения и возвращается в подбор по `expires_at`.
  Миграция 0009 пересобрала `rematch_invites`, чтобы `recipient_player_id` и
  `recipient_run_id` могли быть пустыми. Дуэль идёт с версией `solo-friend-v1` и
  **вне зачёта**: не в пул, не в таблицу, без приглашений и рейтинга, потому что
  пригласивший уже видел набор; исход против его записи при этом считается и
  виден обоим.
- **Тренировка:** клиентский раздел с ботами на уровнях (`practice.ts`) и
  отработкой ошибок по локальному `mistakeLog`; результат не уходит в
  соревнование (`solo-practice-v1`).
- **«Мои партии»:** `GET /api/my-runs` (курсорная выдача, `historyRepository`) и
  экран `MyRuns`.
- **Навигация:** `BottomNav` — четыре раздела; фазы и системный Back описаны
  в `App`/`telegramBackButton`.

Цель забега и потолок кругов заданы константами `SOLO_TARGET_PROGRESS` и
`SOLO_ROUND_CAP` в `packages/shared/src/soloRun.ts`; здесь не дублируются, чтобы не
расходиться с кодом.

## Поток данных гонки (`race-to-100`, устаревший путь)

Этот путь и `POST /api/async-matches` остаются в API для ранее выданных
приглашений; с главной в них войти нельзя. Подробности сохранены, потому что
код ещё содержит эти правила.

1. `main.tsx` синхронно создаёт один React root с `AppBootstrap`: сначала виден
   доступный loading shell. `initializeTelegram()` возвращает один cached Promise
   (включая StrictMode); browser/non-TMA завершается сразу. Через 2,5 секунды либо
   при ошибке App всё равно открывается с неблокирующим статусом. Поздний успех
   обновляет только bootstrap-состояние, не создаёт второй root и не перемонтирует
   App. Telegram `ready` и отдельный core-ready signal доступны до фонового
   `mountViewport`; поздний viewport подключает CSS vars/expand, но не блокирует
   App после timeout и не задерживает BackButton.
2. `App` использует `useGameState`. Фазы: `home`, `categories`, `matchmaking`,
   `question`, `resolution`, `hammer`, `result`, `profile`.
3. Выбор категории сразу запускает один start-запрос с `Authorization`. Telegram передаёт свежий
   initData; браузер получает/продлевает подписанный guest token. Worker выводит
   `player_id` только из проверенной identity, затем выбирает пригодную запись
   той же категории и текущих условий, не самого игрока; предпочитает ещё не
   использованную им. Проверяет до 20 кандидатов на каждом из двух путей:
   unused, затем repeat. Повреждённые записи пропускает; если подходящих нет — бот.
4. Вопросы копируются из записи соперника либо создаются shared-генератором.
   Новый `match_runs` сохраняет снимок вопросов, полную копию соперника, версию
   правил и config мини-игры. Ссылка на исходного ghost остаётся для подбора.
   Бот обрезается после первого собственного достижения 100%.
5. Клиент проверяет версию условий, config, вопросы и транскрипт. Только после
   этого ready-lobby показывает имя, источник и кнопку «Начать», затем считает
   ответ/удар и накапливает входы раундов. Обе шкалы и терминальное состояние
   обновляет `applyMatchRound`; stage повторно выводится из transcript, а награда
   удара — из distance через shared pressure-scoring. `HammerGame` строит
   детерминированный target/вложенные зоны из question id и того же config.
   Вопрос без media сразу получает абсолютный 15-секундный deadline. При
   обязательной картинке deadline создаётся только после успешного `load`; до
   этого формулировка и ответы недоступны, а ошибка загрузки требует retry.
   Скрытие вкладки после старта не останавливает время, а visibility resume
   сразу синхронизирует остаток/истечение.
   Один gate в `QuestionScreen` выбирает answer либо timeout (deadline включён
   в timeout) и передаёт единый elapsed; delayed feedback очищается на unmount.
6. На экране результата клиент отправляет все сыгранные раунды. API повторно
   проверяет ответы, последовательно выводит pressure stage и награды из уже
   пересчитанных результатов, затем вызывает `evaluateMatch` с сохранённой
   копией соперника. Нетерминальный префикс и лишние раунды получают 400 без
   сохранения. Законное завершение сохраняет результат и `ghost_eligible` вместе.
   До отправки payload попадает в durable-очередь. Только валидный ACK того же
   matchId удаляет запись; UI сверяет server progress/correct/rounds. Transient
   ошибки повторяются ограниченно, terminal 4xx остаются видимыми без retry.

Start имеет собственный пятисекундный timeout и принимает caller AbortSignal.
Координатор отменяет запрос при back, игнорирует поздний ответ по монотонному
token и не запускает дубль той же категории. Ошибка остаётся видимой; локальная
практика начинается только по явному выбору.

## API и хранение

| Маршрут | Текущее назначение |
| --- | --- |
| `GET /`, `GET /api/health` | Метаданные и дешёвый liveness процесса; D1 не вызывается |
| `GET /api/ready` | Readiness для трафика: binding D1 и текущая схема `match_runs`, включая колонки миграции 0002 |
| `POST /api/auth/guest` | Выдать новую или продлить существующую guest-сессию |
| `POST /api/solo-runs`, `POST /api/solo-runs/:id/answer`, `/hammer`, `GET /api/solo-runs/:id` | Старт, покруговой счёт на сервере (миграция 0010) и продолжение соло-забега |
| `GET /api/solo-leaderboard` | Таблица соло за сутки по `solo_score` |
| `POST /api/solo-runs/:id/invite` | Открытое приглашение «Позвать друга» |
| `GET /api/rematch/:id` | Данные приглашения на реванш |
| `GET`/`PUT /api/notifications/outbid` | Согласие на уведомления об обгоне |
| `GET /api/my-runs` | История прохождений игрока |
| `GET /api/share`, `GET /api/share/card.png` | OG-страница и картинка результата |
| `POST /api/last-stand/start`, `/:runId/answer`, `GET /api/last-stand/leaderboard` | Last Stand |
| `POST /api/async-matches` | Создать матч гонки (устаревший путь); вернуть вопросы, соперника, `opponentSource`, `conditions` |
| `POST /api/async-matches/:id/complete` | Принять rounds гонки, пересчитать и сохранить результат |
| `GET /api/leaderboard?category=...` | Лучшая цельная completed-запись гонки на игрока, top-50 внутри категории |

До генерации/D1 start и complete проверяют identity, затем отдельный bucket по
`playerId`; guest и leaderboard используют `CF-Connecting-IP` с безопасным
локальным fallback. Все четыре bucket имеют предел 30/60 секунд. При превышении
ответ 429 и `Retry-After: 60`, при недоступном binding — 503. Счётчики нативного
Cloudflare binding локальны для точки присутствия, а не являются глобальным
распределённым лимитом. Локальная разработка использует симуляцию Wrangler,
route-тесты — детерминированный fake binding.

Leaderboard сначала ранжирует записи каждого `player_id` по progress,
correct count, раннему времени завершения и `id`, затем тем же порядком строит
top-50. `completed_at = NULL` при равенстве идёт после известного времени. Имя и
все показатели берутся из одной записи. Сравнимость сырого progress между
разными наборами/условиями пока не утверждена как правило публичного рейтинга.

Start принимает не более 1024 UTF-8 байт JSON, complete — 16384. Completion
ограничен 1..10 раундами: id вопроса 1..128 символов, ответ до 512 (пустой
допустим), время 0..60000 мс; прежний диапазон distance сохранён.

Основная таблица — `match_runs`: id, player_id, display_name, category,
questions_json, rounds_json, progress, correct_count, status, opponent_run_id,
created_at, completed_at. Миграция 0002 добавляет `rules_version`, `mini_game_id`,
`mini_game_config_json`, `opponent_json`, `ghost_eligible` и индекс пригодного пула;
0003 — `question_set_id`; 0007 — `reached_target`, `set_par`, `solo_score`;
0008 — `solo_outcome` и индекс таблицы соло. Остальные таблицы: `last_stand_runs`
(0004), `player_notification_prefs` и `rematch_invites` (0005; 0006 добавляет
`released_at`, 0009 пересобирает таблицу без обязательного адресата).
Полноценного серверного профиля нет.
В браузере хранятся подписанный guest token, локальное отображаемое имя,
versioned completion-очередь до 20 записей и отдельная статистика подтверждённых
online-матчей. Токен в очередь не копируется. Текущий незавершённый матч не
восстанавливается.
Guest token живёт семь дней и продлевает тот же subject за пять минут до срока.

Условия гонки экспортируются как `CURRENT_ASYNC_MATCH_CONDITIONS` из shared
(`race-to-100-v3`, мини-игра `hammer_nail`), условия соло — как
`CURRENT_SOLO_RUN_CONDITIONS`. Числа config молотка (зоны, скорость маркера,
stage multipliers, offsets) живут в shared и менялись: зона идеального попадания
сужена с 0.15 до 0.06, полоса «хорошо» с 0.35 до 0.28, а скорость маркера больше
не константа 0.8, а меняется в диапазоне 0.6–1.6 и выводится из хеша вопроса и
стадии давления. Здесь они намеренно не перечислены повторно: источник истины —
`hammerRules.ts`. Версия покрывает
условия завершения, награды и scoring; при их изменении её нужно менять.
Config сериализуется в постоянном порядке и сравнивается точно. Снимок вопросов
содержит сам контент; отдельной версии датасета в R1b нет. V2 config намеренно
несовместим с v1/старыми runs, поэтому они не выбираются как ghost; новая схема
D1 для этого не понадобилась.

Legacy-строки сохраняются с NULL-условиями и ghost_eligible=0. Незавершённые
legacy/неподдерживаемые матчи получают 409 с просьбой начать заново. Уже
завершённый результат возвращается как сохранён, без переоценки новыми правилами.
Для текущего матча completion читает `opponent_json`, а не меняющуюся исходную
запись и не заново сгенерированного бота. При проигранном conditional UPDATE
сервер перечитывает сохранённый результат; клиент принимает такой ACK
идемпотентно и дедуплицирует confirmed-статистику по matchId.

## Границы доверия

- Start и complete требуют Telegram initData либо подписанный guest token.
  `playerId` из тела не принимается; complete сверяет владельца до выдачи даже
  уже сохранённого результата. Чужой и отсутствующий matchId одинаково дают 404.
- Guest token хранится в localStorage и не является полноценным аккаунтом:
  очистка/кража браузерного хранилища меняет или компрометирует guest identity.
- **Известная незакрытая проблема.** API возвращает полный `Question`, включая
  правильные ответы, и будущие результаты соперника; данные стран и генератор
  лежат в браузерном бандле. Исправляется отдельной задачей, на 2026-10-12 не
  завершено: до её закрытия таблицы и пул не защищены от подделки.
- Последовательный пересчёт pressure stage и награды не доказывает честность
  удара: `skillDistance` и время передаёт клиент. Сервер не применяет лимит
  вопроса в 15 секунд.
- CORS сейчас общий. Ограничение origins полезно для окружений, но само по себе
  не заменяет авторизацию или защиту от поддельного результата.

## Локальный и предполагаемый production-запуск

`npm run dev` запускает Vite :5173 и Wrangler :8787. Vite проксирует `/api`
на Worker; ngrok даёт внешний HTTPS для Vite, поэтому для локального Telegram
достаточно одного адреса. Команды и секреты описаны в [README](../README.md).

`npm run test:smoke:local` создаёт временный config рядом с временной local D1,
поэтому Wrangler не ищет project `.dev.vars`/`.env`. Harness применяет текущие
migrations, проверяет настоящий HTTP-путь guest A → bot → eligible completion →
player ghost B → canonical repeat и удаляет созданное состояние. CI запускает
его между unit-тестами и build; remote Cloudflare этим не проверяется.

Tracked `apps/api/wrangler.toml` остаётся только development-конфигурацией.
`npm run preflight:production` принимает шесть явных `CLUTCH_PRODUCTION_*`
значений, отвергает повторное использование dev Worker/D1/rate namespace и
создаёт полный production Wrangler config только во временном каталоге. Затем
он выполняет `wrangler deploy --dry-run --outdir`, полный root build с отдельным
пустым Vite env-dir и доказывает наличие exact API URL в клиентском bundle.
Cloud credentials и app secrets удаляются из child env; upload, remote migration,
secret mutation и deploy не выполняются. Root deploy aliases отсутствуют,
реальный выпуск остаётся ручной процедурой из [RELEASE](RELEASE.md).
Default и fixture mode удаляют config вместе с temp. Только отдельный npm script
`preflight:production:write-config` после успешных dry-run/build сохраняет JSONC в ignored
`apps/api/wrangler.production.generated.jsonc` с `wx`: без overwrite и без
secrets. После смены resource IDs/names файл нужно удалить и сгенерировать снова.

## Направление изменений, не текущая реализация

- Shared-функции и серверные условия подключены к клиенту в R1c. Это согласует
  переходы, но не доказывает подлинность клиентского времени/точности удара.
- При появлении новых версий решить, какие поддерживать для завершения старых
  матчей. Сейчас неподдерживаемая незавершённая версия требует нового старта.
- Небольшой контракт мини-игры: входные config и прогресс, выход попытки;
  награду определяют правила матча. Не начинать универсальный игровой движок.
- Отделить сетевой жизненный цикл от UI-переходов: загрузка, подтверждение
  результата, повторная отправка и защита от устаревших ответов.

Последовательность изменений и ограничения задач — в [ROADMAP](ROADMAP.md).

## Shared-правила R1a: контракт, используемый API и клиентом

`createMatchRulesState()` создаёт начальное состояние; `applyMatchRound()`
применяет пару уже рассчитанных наград; `evaluateMatch(questionIds, playerRounds,
opponentRounds)` проверяет порядок и сворачивает сыгранную последовательность.
Вход раунда минимален: `{ questionId, progressAwarded }`, поэтому существующие
структуры AsyncMatchRound и OpponentRound совместимы по полям.

Состояние содержит число сыгранных раундов, capped progress обеих сторон,
status, outcome для завершённого матча и ghostEligible. Неполный законный матч
остаётся in_progress; некорректная последовательность вызывает исключение.
Нет неявного нулевого прироста для отсутствующего сыгранного раунда соперника.

Это внутренние правила, не HTTP-валидатор или античит. API вычисляет награды
из проверенных по форме входов и переводит ошибки правил в ответ 4xx.
Не передавать в низкоуровневый apply флаг последнего вопроса или состояние из
непроверенного клиентского JSON. Подбор обязан отдельно проверять происхождение,
полноценность и совместимость версии записи соперника.

Локальные scripts с условными id нормализуются отдельным клиентским адаптером:
id сопоставляются по позиции, хвост после первого 100% удаляется. Онлайн-запись,
наоборот, проходит строгую проверку порядка и не допускает такой коррекции.
