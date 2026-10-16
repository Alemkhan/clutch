# Архитектура: как устроен текущий код

Основа: checkpoint `3015241` с R7c, 2026-10-02; обновлено 2026-10-14 под
действующий solo-путь после удаления гонки (R12), категорию «Общие знания»
(DEC-07) и единый файл схемы (R21).
API и клиент используют shared-правила. **Схема живёт в одной миграции**
`apps/api/migrations/0001_schema.sql`: историю из 17 шагов сжали 2026-10-13, до первого
деплоя (см. комментарий в самом файле). Номера 0002–0017 остались только в истории git.

Основной и единственный режим матча — **соло-забег до 100%** (`solo-to-100-v2`).
Режим гонки (`race-to-100-v3`, `POST /api/async-matches`) **удалён 2026-10-13**
(R12): он отдавал клиенту набор вместе с ответами, а живых приглашений на него
не оставалось. Остатки (чтение легаси-строк, `matchRules.ts`, `MyRunSummary.mode`)
удалены из кода 2026-10-16. Разделы ниже описывают действующий путь; ссылки на гонку в
истории документа сохранены как история, а не как описание кода.

## Карта репозитория

```text
apps/web/                      React 18 + Vite + Framer Motion + Telegram SDK
  src/AppBootstrap.tsx         loading/timeout/error вокруг Telegram init
  src/App.tsx                  переключение экранов по phase, Telegram Back
  src/app/                     оболочка: useGameState (навигация верхнего уровня),
                               gameSession (phase и безопасные переходы), bootstrap, launchIntent
  src/platform/                api.ts (HTTP, Telegram/guest auth, timeout 5 секунд),
                               telegram.ts (cached SDK/initData, viewport), telegramBackButton.ts,
                               analytics.ts (очередь в памяти + dev console, без подключения),
                               sounds.ts, soundPreference.ts, accessibility.ts, share.ts
  src/ui/                      BottomNav (четыре раздела), ScreenHeader, SoundToggle, TimerBar
  src/features/round/          QuestionScreen, ResolutionScreen, MatchHud, OpenAnswerInput:
                               вопрос и разбор, общие для соло и тренировки
  src/features/hammer/         HammerGame и его чистые модули (intro, motion, strike)
  src/features/solo/           основной цикл: SoloRun/SoloHud/SoloResult, useSoloRun,
                               soloRunSession, soloRunFlow (чистые переходы), soloResultModel,
                               soloRoundDelivery (retry одного идемпотентного запроса),
                               clientMatchRules (runtime-проверка solo snapshots и server payload),
                               useFriendInvite, friendDuelResult, RematchEntry, CategorySelect
  src/features/{board,home,tiebreaker,myRuns,training,profile}/  экраны разделов и их модули
  src/features/lastStand/      режим Last Stand (заморожен 2026-10-16)
  src/index.css                только список @import в порядке каскада (порядок значим)
  src/styles/                  tokens.css (:root), base.css, v2-shell.css и общие @media-блоки
  public/{sprites,sfx,flags-historic}/
apps/api/
  src/index.ts                 composition root: Hono, CORS, регистрация routes
  src/env.ts                   Cloudflare bindings
  src/auth/guest.ts            HMAC guest token: issue/verify/renewal subject
  src/auth/identity.ts         Authorization → единый RequestIdentity
  src/auth/telegram.ts         проверка подписи и срока Telegram initData
  src/http/jsonBody.ts         ограниченное по UTF-8 байтам чтение JSON
  src/http/rateLimit.ts        общий адаптер Cloudflare RateLimit и IP-ключ
  src/http/system.ts           metadata, liveness/readiness
  src/auth/auth.ts             выдача/продление browser guest session
  src/solo/                    soloRuns.ts (регистрация маршрутов, resume), startSoloRun (старт), soloRounds (answer/hammer),
                               finalizeSoloRun (закрытие забега), soloLeaderboard (таблица solo), soloShared,
                               soloRepository/soloRoundsRepository (D1 solo), matchmaking (подбор),
                               repository (создание, подбор и завершение), bots (BotProfile и снимок
                               bot opponent), validation (HTTP-входы и сохранённые snapshots),
                               types (внутренний тип строки match_runs)
  src/rematch/                 friendInvites.ts («Позвать друга»), rematch.ts (реванш, согласие на уведомления)
  src/myRuns/, src/profile/, src/training/, src/tiebreaker/, src/telemetry/
                               по одному route и (где нужен) repository на фичу
  src/share/share.ts           OG-страница и карточка результата
  src/lastStand/lastStand.ts   Last Stand: старт, ответ, таблица
  src/notifications/           приглашения на реванш, Telegram-сообщения, плановый возврат просроченных
  src/lastStand/, src/share/   Last Stand и рендер карточки результата (остальные файлы папок)
  migrations/0001_schema.sql    вся схема: 6 таблиц и 14 индексов, с причинами в комментариях
  wrangler.toml                Worker, D1, Rate Limiting binding и cron возврата приглашений
packages/shared/src/
  index.ts                     типы, versioned conditions и exports
  hammerRules.ts               pressure stage, target, thresholds, distance и scoring
  questionGenerator.ts         сборка набора по категории (страны, флаги, языки)
  generalPack/                 загрузка пакета общих знаний из content/*.json и проверка формы записей
content/questions/<тема>.json  вопросы общих знаний (605 записей, 16 тем)
content/sets/<тема>.json       закрытые категории «назови …» (52) — Last Stand и вопрос «что из этого — …?»
  generalSet.ts                набор дня категории `general`: 14 записей пакета + 6 генераторных
  questionResolve.ts           фасад восстановления вопроса по id: генераторы + `gp:`-id пакета
  seededRandom.ts              `createSeededRandom` и `hashSeed` (вынесены, чтобы развязать импорты)
  countries.ts                 197 записей стран/территорий
  historicFlags.ts             44 записи («Другие флаги», id `history`); изображения локально в web
  languages.ts                 37 языков и примеры письма
  flagTraits.ts, fuzzyMatch.ts  похожие дистракторы и проверка открытого ответа
  soloRun.ts, soloCompare.ts   правила соло-забега и сравнение по solo_score
  practice.ts, friendDuel.ts   версии `solo-practice-v1` / `solo-friend-v1`, уровни ботов
  dailyQuestionSet.ts          покатегорийные размеры наборов и банк наборов дня
  narrowCategories.ts, lastStand.ts  Last Stand; круг берёт категорию из узких страновых
                               и из закрытых наборов пакета (35 узких и 12 средних, с 2026-10-12)
  questionPricing.ts           оценка «цены» вопроса по формату
tests/telegramAuth.test.ts      3 unit-теста initData
tests/botOpponent.test.ts       3 unit-теста профилей и фабрики бота
tests/guestAuth.test.ts         unit-тесты подписи и срока guest token
tests/identity.test.ts          разбор Telegram/guest Authorization
tests/soloRuns.test.ts          старт/resume и выдача solo-набора
tests/soloRounds.test.ts        серверный answer/hammer и идемпотентность кругов
tests/soloBookkeeping.test.ts   захват записи, завершение и освобождение пары
tests/requestLimits.test.ts      лимиты тела/полей и rate-limit маршрутов R2b
tests/helpers/testD1.ts         in-memory SQLite adapter для API-тестов
apps/web/src/features/solo/clientMatchRules.test.ts  runtime-проверка solo payload
apps/web/src/features/solo/soloRunFlow.test.ts       чистые переходы покругового solo
apps/web/src/platform/api.test.ts               HTTP payload и browser guest session
packages/shared/src/index.test.ts          целостность активных наборов
scripts/smoke-local.mjs            изолированный Wrangler/D1 HTTP smoke
scripts/preflight-production.mjs   production config → dry-run + exact web build
scripts/lib/production-preflight.mjs  чистая validation/config generation
.github/workflows/ci.yml           unit → local HTTP smoke → preflight fixture/build
```

### Стили

Обычный CSS, один вход `apps/web/src/index.css` (его импортирует `main.tsx`); в нём
только `@import`. Файлы лежат рядом с фичами (`features/<name>/*.css`, `ui/*.css`),
глобальные — в `styles/`. Порядок импортов совпадает с порядком правил в бывшем
едином файле и определяет каскад: не переставляй и не объединяй куски без
визуальной проверки. `*.v2.css` — переопределения v2, стоящие позже старой секции
экрана; при работе над экраном их сливают со старым куском (с проверкой экрана).
`cssDuplicates.test.ts` следит, что каждый `.css` подключён ровно один раз и что
на объединённом тексте селектор верхнего уровня объявлен один раз. CSS из
компонентов не импортируется: это сломало бы порядок.

## Как читать основной сценарий

Клиентский путь начинается в `App`, но правила solo-круга там не живут:

```text
App → SoloRun → useSoloRun (React, сеть, retry) → soloRunFlow (чистые переходы)
                                            ↘ clientMatchRules → shared/soloRun
```

Серверный путь начинается с маленькой точки сборки. Доменные SQL-запросы матчей
остаются в repository; системный route содержит только фиксированный read-only
schema probe для readiness:

```text
index → http/system → D1 readiness
     ├→ auth/auth → auth/guest
     ├→ solo/soloRuns → auth/identity → auth/{telegram,guest}
     │                 ├→ http/{rateLimit,jsonBody}
     │                 ├→ solo/{matchmaking,validation}
     │                 ├→ solo/{soloRepository,soloRoundsRepository}
     │                 └→ shared/{soloRun,hammerRules}
     └→ {rematch/{friendInvites,rematch},myRuns,lastStand,training,share,...}
```

Соло-путь (`solo/soloRuns`, `rematch/*`, `myRuns`) устроен так же:
SQL в `*Repository` и `notifications/repository`, правила в shared.

Новый профиль бота добавляется в `solo/bots.ts`. Новый HTTP-сценарий — в
папке своей фичи; SQL остаётся в `repository`. Переход вопрос → разбор → skill → итог
меняется и тестируется в `soloRunFlow`, а условия завершения и scoring — в shared.

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

- **Старт и завершение:** `POST /api/solo-runs`, `POST /api/solo-runs/:id/answer`, `/hammer` (покруговая отправка), `GET /api/solo-runs/:id` (продолжение); `POST /api/training/questions`, `/check` (отработка ошибок);
  таблица за сутки — `GET /api/solo-leaderboard` (только дошедшие до цели, по
  категории и `solo_score`; индекс `idx_match_runs_solo_board`).
- **Подбор:** `solo/matchmaking.ts` берёт свободную запись на несыгранном
  игроком наборе из банка дня, иначе несыгранный набор с ботом, иначе любую
  свободную запись, иначе давнее всего сыгранный набор. Если игрок прошёл все
  наборы дня, клиент может прямо сказать, что набор повторяется.
- **Размеры наборов:** `DAILY_SET_SIZES` — `general` («Общие знания») и география
  по 20 вопросов и 12 наборов в банке дня, `history` («Другие флаги») и
  `languages` по 18 и 6 наборов. Причина: у флагов 44 сущности, у языков 37 и по
  одному шаблону вопроса, тогда как в географии 197 стран на семь шаблонов.
  Набор в `match_runs` определяет `question_set_id`, поэтому id
  `history` менять нельзя.
- **Набор «Общих знаний» собирается иначе** (`generalSet.ts`). Остальные три
  категории строит `generateMatch` по сущностям; `general` для него — неизвестная
  категория, и он на ней бросает `RangeError`. Набор из 20 вопросов — это
  14 записей пакета (`generalPack/`) плюс 6 вопросов генераторов (3 география,
  2 флаги, 1 языки). Пул пакета перемешивается по сиду `general:<дата>`, набор
  с индексом `i` берёт окно `[i*14, i*14+14)`, поэтому за сутки 12 наборов
  используют 168 записей из 657 и ни одна не повторяется; если одобренных
  записей не хватит, список пойдёт по кругу с другим сидом. Из 14 пакетных
  записей 4 подаются открытым вводом — только те, у кого он разрешён. Набор
  детерминирован: одинаковые id и дата дают байт-идентичный набор.
- **Одна и та же запись в двух категориях.** Генераторная треть `general` берётся
  из тех же генераторов, что и отдельные категории, а ledger шаблонов у каждого
  банка свой. Поэтому вопрос про страну может встретиться игроку и в общем
  режиме, и в географии одного дня. Это принято, а не предотвращено: общий
  ledger сделал бы наборы зависимыми от порядка сборки банков и сломал бы
  детерминированность.
- **Восстановление вопроса по id** (отработка ошибок) идёт через
  `questionResolve.ts`: сначала генераторы, затем id пакета вида
  `gp:<запись>:open|mc` и `gp:set-<набор>:<участник>`. Неизвестный id даёт `null`,
  как и раньше.
- **Матч — пара (DEC-09).** Подбор отдаёт запись одному: `claimRecord` в
  `solo/repository.ts` делает условный `UPDATE ... WHERE claimed_by IS NULL`
  и возвращает `changes > 0`. Это замена `SKIP LOCKED`, которого в D1 нет.
  Пул (`findGhostInSets`) берёт только записи с незанятым или просроченным
  захватом и только те, у которых `opponent_run_id IS NULL`: забег, уже
  сыгравший матч, вторым соперником не становится. Захват живёт `CLAIM_TTL_MS`
  `CLAIM_IDLE_MS` (3 минуты) **молчания**, а не фиксированное окно от захвата:
  отсчёт идёт от последнего круга в `solo_run_rounds`, поэтому играющий человек
  запись не теряет, а ушедший освобождает её быстро. Перехват рвёт пару
  (`dropPace`): у прежнего претендента снимается `opponent_run_id`, иначе он
  вернулся бы и доиграл против записи, которую уже играет другой. Завершённый
  забег запись не отпускает: матч состоялся. Это колонки `claimed_by`/`claimed_at`
  и `pace_released` в `match_runs`.
- **Кто сыграл мою запись.** Связь живёт на строке претендента
  (`opponent_run_id`), поэтому своя строка соперника не знает. «Мои партии»
  достают его подзапросом `played_by`; без этого владелец записи видел «Победа»
  без имени.
- **Реванш:** когда один забег обошёл чужой, создаётся одноразовое приглашение со
  сроком (`rematch_invites`); реванш идёт на новом наборе. Получатель открывает его
  по startapp-ссылке (`rm_…`), `GET /api/rematch/:id`. Согласие на уведомления —
  `/api/notifications/outbid` (по умолчанию включено, отписка в сообщении).
- **Возврат просроченных:** cron раз в 15 минут (`wrangler.toml`) вызывает
  `releaseExpiredRematchInvites`; просроченные неиспользованные приглашения
  получают `released_at`, а запись возвращается в общий подбор.
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

## API и хранение

| Маршрут | Текущее назначение |
| --- | --- |
| `GET /`, `GET /api/health` | Метаданные и дешёвый liveness процесса; D1 не вызывается |
| `GET /api/ready` | Readiness для трафика: binding D1 и текущая схема `match_runs`, включая колонки снимка условий |
| `POST /api/auth/guest` | Выдать новую или продлить существующую guest-сессию |
| `POST /api/solo-runs`, `POST /api/solo-runs/:id/answer`, `/hammer`, `GET /api/solo-runs/:id` | Старт, покруговой счёт на сервере (`solo_run_rounds`) и продолжение соло-забега |
| `GET /api/solo-leaderboard` | Таблица соло за сутки по `solo_score` |
| `POST /api/solo-runs/:id/invite` | Открытое приглашение «Позвать друга» |
| `GET /api/rematch/:id` | Данные приглашения на реванш |
| `GET`/`PUT /api/notifications/outbid` | Согласие на уведомления об обгоне |
| `GET /api/my-runs` | История прохождений игрока |
| `GET /api/share`, `GET /api/share/card.png` | OG-страница и картинка результата |
| `POST /api/last-stand/start`, `/:runId/answer`, `GET /api/last-stand/leaderboard` | Last Stand |

Маршруты, меняющие solo/приглашения/training, проверяют identity, затем отдельный
bucket по `playerId`; guest auth использует `CF-Connecting-IP` с безопасным
локальным fallback. Bucket имеет предел 30/60 секунд. При превышении
ответ 429 и `Retry-After: 60`, при недоступном binding — 503. Счётчики нативного
Cloudflare binding локальны для точки присутствия, а не являются глобальным
распределённым лимитом. Локальная разработка использует симуляцию Wrangler,
route-тесты — детерминированный fake binding.

Solo board сначала выбирает лучший достигший цели забег каждого `player_id`,
затем строит top-50 по меньшему `solo_score`, числу кругов, длительности и `id`.
Ответ отдельно прикладывает место текущего игрока и расстояние до стоящего выше.

JSON-body каждого изменяющего маршрута ограничен по UTF-8 байтам. Answer/hammer
принимают ровно текущий индекс и id вопроса; answer ограничивает строку ответа и
заявленное время, hammer принимает только сырой `activeElapsedMs`. Повтор одного
и того же запроса идемпотентен: сервер возвращает уже записанный круг.

Основная таблица — `match_runs`: id, player_id, display_name, category,
questions_json, rounds_json, progress, correct_count, status, opponent_run_id,
created_at, completed_at, снимок условий, claim/pace, `reached_target`, `set_par`,
`solo_score` и `solo_outcome`. `solo_run_rounds` хранит покруговые answer/hammer,
включая измеренное сервером окно, момент удара и выведенный результат. Остальные
таблицы: `player_mistakes`, `rematch_invites`, `player_notification_prefs` и
`last_stand_runs`. Вся итоговая схема создаётся `0001_schema.sql`; номера прежних
шагов 0002–0017 — только история до первого deploy.
Полноценного серверного профиля нет.
В браузере хранятся подписанный guest token, локальное отображаемое имя,
id активного solo-забега. Круги живут на сервере,
поэтому активный solo-забег восстанавливается по id после перезагрузки; вопросы
и ответы в localStorage не копируются.
Guest token живёт семь дней и продлевает тот же subject за пять минут до срока.

`CURRENT_HAMMER_MINI_GAME` (shared; до 2026-10-16 `CURRENT_ASYNC_MATCH_CONDITIONS`):
конфиг мини-игры `hammer_nail`, которым считается круг соло; его читают solo
route/repository и shared `hammerRules.ts`. Условия соло — как
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

Legacy-строки сохраняются с NULL-условиями и `ghost_eligible=0`; действующий пул
их не выбирает. Уже записанный solo-круг не переоценивается новыми правилами:
повтор answer/hammer получает сохранённый verdict, а конфликт порядка даёт 409 и
заставляет клиент восстановить серверное состояние.

## Границы доверия

- Solo routes требуют Telegram initData либо подписанный guest token.
  `playerId` из тела не принимается; answer/hammer/resume сверяют владельца до
  выдачи даже уже сохранённого результата. Чужой и отсутствующий run id
  одинаково дают 404.
- Guest token хранится в localStorage и не является полноценным аккаунтом:
  очистка/кража браузерного хранилища меняет или компрометирует guest identity.
- До ответа API возвращает только `PublicQuestion`: без `correctOptionId`,
  `correctAnswers`, explanation и source metadata. Правильный ответ приходит
  только вместе с серверным verdict этого круга. Это покрыто route-тестами
  `noAnswerLeak`; наличие общих типов/генераторов в monorepo не означает их
  включения в web bundle (отдельный bundle-тест проверяет экспортируемые данные).
- **Оценку удара считает сервер** (колонка `active_elapsed_ms`). Клиент присылает только
  момент удара — активное время от старта маркера (`activeElapsedMs`), — а
  положение маркера, расстояние до цели и tier выводит общая
  `scoreHammerTap` в shared: цель и скорость детерминированы по id вопроса и
  стадии давления, так что сервер считает ровно то, что игрок видел. Присланное
  время проверяется на невозможное: оно не может превышать измеренное сервером
  окно круга больше чем на 5 секунд. Это **не** защита от подобранного момента:
  маркер периодичен, удачная фаза повторяется каждые 1,2–3,3 секунды, и знающий
  формулу может вычислить нужное время. Сырой момент хранится в
  `solo_run_rounds.active_elapsed_ms` рядом с выведенным `skill_distance` —
  материал для поиска выбросов, когда понадобятся лиги.
- **Окно ответа мерит сервер** (колонка `answer_window_ms`). `responseTimeMs` всё ещё
  присылает клиент, но рядом хранится `solo_run_rounds.answer_window_ms` —
  промежуток, который сервер увидел сам: от закрытия предыдущего круга (у
  первого — от старта забега) до прихода ответа. Заявленное время больше окна
  отклоняется 400. Окно — верхняя граница, а не длительность вопроса: внутрь
  входят разбор и удар предыдущего круга, а у продолженного забега — время
  закрытой вкладки. **Лимит 15 секунд сервер не применяет и нынешним протоколом
  применить не может:** набор уходит клиенту целиком, вопрос можно прочитать
  заранее. Для лимита набор нужно отдавать по одному вопросу.
- **Сутки игры начинаются не в полночь UTC.** `DAY_BOUNDARY_OFFSET_MINUTES`
  (+5 часов) сдвигает границу на 19:00 UTC — полночь в Алматы, 02:00 в Москве.
  По ней считаются и набор дня (`dailyKey`), и окно таблицы (`dayStartMs`).
  Граница одна для всех: со своим часовым поясом у каждого таблица сравнивала бы
  разные наборы.
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
