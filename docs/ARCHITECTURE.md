# Архитектура: как устроен текущий код

Основа: checkpoint `0526cda`; дополнено R7a в рабочем дереве, 2026-10-01.
API и клиент используют shared-правила; схема условий добавлена миграцией 0002.

## Карта репозитория

```text
apps/web/                      React 18 + Vite + Framer Motion + Telegram SDK
  src/App.tsx                  переключение экранов по phase
  src/lib/useGameState.ts       React/API/analytics orchestration
  src/lib/gameSession.ts        чистое состояние и переходы игровой сессии
  src/lib/clientMatchRules.ts   runtime-проверка условий и транскриптов R1c
  src/lib/api.ts                HTTP, Telegram/guest auth, timeout 5 секунд
  src/lib/completionQueue.ts    durable completion, ACK, retry/single-flight
  src/lib/telegram.ts           initData, SDK, viewport
  src/lib/sampleData.ts         локальный соперник, генерация и config молотка
  src/lib/tournaments.ts        фиксированный challenge Robb Peters
  src/lib/localStats.ts         localStorage: победы/поражения/серии
  src/lib/analytics.ts          очередь в памяти + dev console, без подключения
  src/lib/sounds.ts             воспроизведение текущих эффектов
  src/components/              вопросы, MatchHud, HammerGame, итог, профиль
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
  src/routes/leaderboard.ts    HTTP-маршрут leaderboard
  migrations/0001_async_matches.sql
  migrations/0002_match_conditions.sql  условия, снимок соперника, пригодность ghost
  wrangler.toml                Worker, D1 и нативный Rate Limiting binding
packages/shared/src/
  index.ts                     типы, SKILL_REWARDS, resultFromDistance, exports
  matchRules.ts                чистые правила раунда/матча и пригодности ghost
  matchRules.test.ts           детерминированные регрессии для этих правил
  questionGenerator.ts         сборка набора по категории
  countries.ts                 197 записей стран/территорий
  historicFlags.ts             44 записи; изображения локально в web
  languages.ts                 37 языков и примеры письма
  flagTraits.ts, fuzzyMatch.ts  похожие дистракторы и проверка открытого ответа
  questionBank.ts, showQuiz.ts  заготовки, не подключённые к основному циклу
tests/telegramAuth.test.ts      3 unit-теста initData
tests/botOpponent.test.ts       3 unit-теста профилей и фабрики бота
tests/guestAuth.test.ts         unit-тесты подписи и срока guest token
tests/identity.test.ts          разбор Telegram/guest Authorization
tests/asyncMatches.test.ts      25 route/SQL-тестов R1/R2a
tests/requestLimits.test.ts      лимиты тела/полей и rate-limit маршрутов R2b
tests/helpers/testD1.ts         in-memory SQLite adapter для API-тестов
apps/web/src/lib/clientMatchRules.test.ts  13 клиентских тестов R1c
apps/web/src/lib/gameSession.test.ts       9 тестов чистых переходов сессии
apps/web/src/lib/api.test.ts               срок и renewal browser guest session
packages/shared/src/index.test.ts  15 unit-тестов shared
```

## Как читать основной сценарий

Клиентский путь начинается в `App`, но правила переходов там не живут:

```text
App → useGameState (React, сеть, эффекты) → gameSession (чистые переходы)
                                      ↘ clientMatchRules → shared/matchRules
```

Серверный путь начинается с маленькой точки сборки; маршрут координирует,
но не содержит реализацию HMAC, SQL или фабрику бота:

```text
index → routes/auth → auth/guest
     └→ routes/asyncMatches → auth/identity → auth/{telegram,guest}
                         ├→ http/{rateLimit,jsonBody}
                          ├→ matches/bots
                          ├→ matches/validation → shared/matchRules
                          └→ matches/repository → D1
```

Новый профиль бота добавляется в `matches/bots.ts`. Новый HTTP-сценарий — в
`routes`; SQL остаётся в `repository`. Переход вопрос → разбор → skill → итог
меняется и тестируется в `gameSession`, а общие условия победы — в shared.

## Поток данных

1. `main.tsx` ждёт `initializeTelegram()`, затем монтирует React. В браузере
   без Telegram SDK-инициализация пропускается.
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
   обновляет `applyMatchRound`; награда удара повторно выводится из distance.
   Вопрос без media сразу получает абсолютный 15-секундный deadline. При
   обязательной картинке deadline создаётся только после успешного `load`; до
   этого формулировка и ответы недоступны, а ошибка загрузки требует retry.
   Скрытие вкладки после старта не останавливает время, а visibility resume
   сразу синхронизирует остаток/истечение.
   Один gate в `QuestionScreen` выбирает answer либо timeout (deadline включён
   в timeout) и передаёт единый elapsed; delayed feedback очищается на unmount.
6. На экране результата клиент отправляет все сыгранные раунды. API повторно
   проверяет ответы, вычисляет награды и вызывает `evaluateMatch` с сохранённой
   копией соперника. Нетерминальный префикс и лишние раунды получают 400 без
   сохранения. Законное завершение сохраняет результат и `ghost_eligible` вместе.
   До отправки payload попадает в durable-очередь. Только валидный ACK того же
   matchId удаляет запись; UI сверяет server progress/correct/rounds. Transient
   ошибки повторяются ограниченно, terminal 4xx остаются видимыми без retry.

Start имеет собственный пятисекундный timeout и принимает caller AbortSignal.
Координатор отменяет запрос при back, игнорирует поздний ответ по монотонному
token и не запускает дубль той же категории. Ошибка остаётся видимой; локальная
практика начинается только по явному выбору. Challenge с фиксированными вопросами
не вызывает API и помечается отдельно от локальной практики.

## API и хранение

| Маршрут | Текущее назначение |
| --- | --- |
| `GET /`, `GET /api/health` | Метаданные/health процесса; не проверка доступности D1 |
| `POST /api/auth/guest` | Выдать новую или продлить существующую guest-сессию |
| `POST /api/async-matches` | Создать матч; вернуть вопросы, соперника, `opponentSource`, `conditions` |
| `POST /api/async-matches/:id/complete` | Принять rounds, пересчитать и сохранить результат |
| `GET /api/leaderboard?category=...` | Агрегат завершённых записей, пока с ошибками выборки |
| `GET /api/tournaments/:slug` | Заглушка, не хранилище турниров |

До генерации/D1 start и complete проверяют identity, затем отдельный bucket по
`playerId`; guest и leaderboard используют `CF-Connecting-IP` с безопасным
локальным fallback. Все четыре bucket имеют предел 30/60 секунд. При превышении
ответ 429 и `Retry-After: 60`, при недоступном binding — 503. Счётчики нативного
Cloudflare binding локальны для точки присутствия, а не являются глобальным
распределённым лимитом. Локальная разработка использует симуляцию Wrangler,
route-тесты — детерминированный fake binding.

Start принимает не более 1024 UTF-8 байт JSON, complete — 16384. Completion
ограничен 1..10 раундами: id вопроса 1..128 символов, ответ до 512 (пустой
допустим), время 0..60000 мс; прежний диапазон distance сохранён.

Единственная таблица — `match_runs`: id, player_id, display_name, category,
questions_json, rounds_json, progress, correct_count, status, opponent_run_id,
created_at, completed_at. Миграция 0002 добавляет `rules_version`, `mini_game_id`,
`mini_game_config_json`, `opponent_json`, `ghost_eligible` и индекс пригодного пула.
Полноценного серверного профиля нет.
В браузере хранятся подписанный guest token, локальное отображаемое имя,
versioned completion-очередь до 20 записей и отдельная статистика подтверждённых
online-матчей. Токен в очередь не копируется. Текущий незавершённый матч не
восстанавливается.
Guest token живёт семь дней и продлевает тот же subject за пять минут до срока.

Текущие условия экспортируются как `CURRENT_ASYNC_MATCH_CONDITIONS` из shared:
`race-to-100-v1`, `hammer_nail`, config 0.8 / 0.85 / 0.15. Версия покрывает
условия завершения, награды и scoring; при их изменении её нужно менять.
Config сериализуется в постоянном порядке и сравнивается точно. Снимок вопросов
содержит сам контент; отдельной версии датасета в R1b нет. Новый config намеренно
несовместим со старыми runs, поэтому они не выбираются как ghost; rulesVersion и
схема D1 от этого не менялись.

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
- API возвращает полный `Question`, включая правильные ответы, и будущие
  результаты соперника. Общие данные/генератор также доступны клиенту.
- Пересчёт награды не доказывает честность удара: `skillDistance` и время
  передаёт клиент. Сервер не применяет лимит вопроса в 15 секунд.
- CORS сейчас общий. Ограничение origins полезно для окружений, но само по себе
  не заменяет авторизацию или защиту от поддельного результата.

## Локальный и предполагаемый production-запуск

`npm run dev` запускает Vite :5173 и Wrangler :8787. Vite проксирует `/api`
на Worker; ngrok даёт внешний HTTPS для Vite, поэтому для локального Telegram
достаточно одного адреса. Команды и секреты описаны в [README](../README.md).

Целевой deploy: Cloudflare Pages + Workers + D1. Production-конфигурация
и удалённое состояние сейчас не подтверждены. `deploy:web` в корне ссылается
на отсутствующий script web-пакета; считать релизную процедуру готовой нельзя.

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
