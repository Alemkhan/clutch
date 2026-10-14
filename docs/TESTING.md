# Тестирование Clutch

Этот документ описывает проверку текущего прототипа локально, в обычном
браузере и внутри Telegram. Все команды ниже выполняются из корня репозитория,
если не указано обратное.

Локальный тест не является production-деплоем. Он использует Vite на порту
`5173`, локальный Cloudflare Worker на `8787`, локальную D1 и HTTPS-туннель до
Vite. Vite перенаправляет `/api` в Worker, поэтому для Telegram нужен один
публичный URL.

## 1. Что понадобится

- Windows PowerShell.
- Node.js **22.17.0** — версия закреплена в [`.nvmrc`](../.nvmrc).
- npm из этой версии Node.
- Telegram-бот и его token от `@BotFather` — только для проверки внутри
  Telegram.
- Туннель для публичного HTTPS URL: `cloudflared` (бесплатно, без заглушки)
  либо ngrok — у бесплатного ngrok внутри Telegram мешает заглушка, см. 5.2.1.
- Для полноценной проверки async-соперника: два разных Telegram-аккаунта либо
  один Telegram-аккаунт и отдельная browser guest-сессия.

Проверить Node и npm:

```powershell
node --version
npm --version
```

`node --version` должен показать `v22.17.0`.

## 2. Первый локальный запуск

### 2.1. Установить зависимости

```powershell
npm ci
```

Используйте `npm ci`, чтобы установить ровно версии из `package-lock.json`.

### 2.2. Создать локальные переменные Worker

```powershell
Copy-Item apps/api/.env.example apps/api/.dev.vars
```

Откройте `apps/api/.dev.vars` и заполните:

```dotenv
TELEGRAM_BOT_TOKEN=token_этого_же_бота_из_BotFather
SESSION_SIGNING_SECRET=случайная_строка_не_короче_32_символов
```

Сгенерировать подходящий secret в PowerShell можно так:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Не коммитьте `.dev.vars` и не отправляйте его содержимое в чат или логи.

Для обычного браузера `TELEGRAM_BOT_TOKEN` почти не участвует: браузер получает
подписанную guest-сессию. Для запуска внутри Telegram token обязан принадлежать
именно тому боту, через которого открывается Mini App, иначе проверка `initData`
даст `401`.

### 2.3. Применить миграции к локальной D1

```powershell
npm exec --workspace @clutch/api -- wrangler d1 migrations apply clutch-db --local
```

Команда безопасна для локальной базы и не меняет remote D1. Повторяйте её после
появления новых миграций.

Если этого не сделать, игра падает не на старте, а в первом же запросе, и ошибка
выглядит как ошибка кода: на пустой базе первый же запрос даст `D1_ERROR: no such
table: match_runs`. Схема лежит в единственном `0001_schema.sql`, поэтому либо
применено всё, либо ничего. Проверить:

```powershell
npm exec --workspace @clutch/api -- wrangler d1 migrations list DB --local
```

Перед применением миграции, которая пересобирает таблицы (такова 0012),
скопируйте файл базы из `apps/api/.wrangler/state/v3/d1/`: применение идёт без
транзакции.

### 2.4. Запустить frontend и backend

```powershell
npm run dev
```

Ожидаемые адреса:

- приложение: `http://127.0.0.1:5173`;
- API: `http://127.0.0.1:8787`;
- liveness: `http://127.0.0.1:8787/api/health`;
- readiness D1: `http://127.0.0.1:8787/api/ready`.

Быстрая проверка API из второго PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
Invoke-RestMethod http://127.0.0.1:8787/api/ready
```

Оба ответа должны содержать `status: ok` и `environment: development`.
Readiness дополнительно возвращает `checks.d1: ok`: он проверяет локальный D1
binding и текущую схему `match_runs`. Если `/api/health` отвечает 200, а
`/api/ready` — 503, Worker жив, но миграции не применены либо D1 недоступна;
повторите шаг 2.3 и проверьте binding. Ответ намеренно не раскрывает SQL или
текст внутренней ошибки.

## 3. Автоматические проверки

Перед ручным тестом и перед каждым checkpoint:

```powershell
npm test
npm run test:smoke:local
npm run test:preflight:production
```

`npm run build` включает typecheck всех workspaces и production-сборку web.
Предупреждение Node о том, что `node:sqlite` experimental, ожидаемо для текущих
route-тестов.

`npm run test:smoke:local` запускает [Node-harness](../scripts/smoke-local.mjs),
который:

- создаёт временные Wrangler config и persist-каталог вне репозитория;
- копирует и применяет туда текущие D1 migrations только с `--local`;
- запускает настоящий `wrangler dev` на свободном localhost-порту и ждёт
  `/api/ready`;
- по HTTP проверяет `401` без auth, две независимые guest-сессии, bot для A,
  eligible completion A, точный player ghost для B и идемпотентный completion B;
- всегда останавливает Worker и удаляет только созданный временный каталог.

Harness не читает project `.dev.vars`/`.env`: config, test vars и рабочий каталог
находятся внутри временной директории. Cloudflare-аккаунт, сеть Cloudflare,
remote D1 и deploy не используются.

Этот smoke не эмулирует браузер и не доказывает offline/reload/retry очереди.
Такие сценарии, а также несовместимые/повреждённые ghost и legacy conditions,
остаются отдельным unit/route-уровнем и ручным walkthrough из раздела 8.

CI выполняет `npm ci`, `npm test`, `npm run test:smoke:local` и
`npm run test:preflight:production`; fixture уже включает полный root build.
Он использует reserved `.invalid` URL и fake IDs, создаёт production-only config
в temp, запускает только Wrangler dry-run и проверяет exact URL в web bundle;
fixture никогда не сохраняет config. В real mode только явный
`npm run preflight:production:write-config` после успешных проверок создаёт
ignored `apps/api/wrangler.production.generated.jsonc` через fail-if-exists.
Файл содержит resource IDs/names, но не secrets; после изменения ресурсов его
нужно удалить и сгенерировать заново. Это не проверка реальных production
resources, secrets или deploy. Локальный
зелёный прогон не доказывает, что GitHub Actions уже выполнялся в remote-репозитории.

## 4. Проверка в обычном браузере

Откройте `http://127.0.0.1:5173`. Вне Telegram приложение должно продолжить
работу как browser guest.

Минимальный smoke test:

1. Домашний экран открывается без вечного loading.
2. «Играть» сразу начинает забег в категории «Общие знания», без промежуточного
   экрана выбора. Другая категория выбирается кнопкой «Другие категории» на
   экране «Забег готов» — к этому моменту набор дня уже выдан и израсходован.
3. Появляется экран «Забег готов»; запись соперника может быть показана в HUD,
   но не завершает забег за игрока.
4. Кнопка «Начать» открывает вопрос.
5. На вопросе с картинкой варианты недоступны до успешной загрузки media.
6. Разбор явно показывает правильный ответ; для неверного MC отдельно видны
   выбранный и правильный варианты. Неверный ответ не даёт мини-игру.
7. Правильный ответ после разбора открывает hammer mini-game.
8. После успешных ударов зоны постепенно сужаются и немного смещаются.
9. Забег заканчивается, когда сам игрок достигает 100%, упирается в потолок
   кругов либо заканчивает набор; полоса записи не обрывает игру.
10. Online-круги сохраняются сразу, а итоговый экран показывает подтверждённый
    сервером результат. Тренировка явно помечена как незачётная.

Полезные URL:

- `http://127.0.0.1:5173/api/health` — health через Vite proxy;
- `http://127.0.0.1:5173/api/ready` — D1 readiness через Vite proxy.

Таблицу дня проверяйте через ссылку на главной: `/api/solo-leaderboard`
требует Authorization и не предназначен для ручного открытия адресной строкой.

### Mobile viewport в DevTools

Проверьте минимум два размера:

- `360 × 640`;
- `390 × 844`.

Дополнительно:

- длинный вопрос и длинные варианты;
- open-answer с открытой экранной клавиатурой;
- поворот экрана;
- browser zoom 200%;
- `prefers-reduced-motion: reduce`;
- уход вкладки в background и возврат;
- медленную сеть и ошибку загрузки изображения.

Таймер не должен начинаться до первой успешной загрузки обязательного media.
После старта скрытие вкладки не должно замораживать deadline.

## 5. Открытие локального приложения внутри Telegram

Обычный production Telegram требует публичный HTTPS URL. Telegram test server
умеет работать с HTTP, но для ежедневной проверки проще использовать стандартный
Telegram и ngrok.

Официальные справки:

- [Telegram Mini Apps](https://core.telegram.org/bots/webapps);
- [ngrok: публикация localhost](https://ngrok.com/use-cases/share-localhost).

### 5.1. Создать или выбрать бота

В `@BotFather`:

1. Выполните `/newbot`, если тестового бота ещё нет.
2. Сохраните выданный token в `apps/api/.dev.vars` как
   `TELEGRAM_BOT_TOKEN`.
3. Никому не отправляйте token.

После изменения `.dev.vars` перезапустите `npm run dev`.

### 5.2. Настроить ngrok

Установите ngrok CLI по официальной инструкции и один раз добавьте authtoken:

```powershell
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
```

При уже запущенном `npm run dev` откройте второй PowerShell:

```powershell
npm run tunnel
```

Скрипт выполняет `ngrok http 5173`. Если команда `ngrok` не найдена, CLI не
установлен или отсутствует в `PATH`.

Скопируйте выданный адрес вида:

```text
https://something.ngrok-free.app
```

Не добавляйте к нему `:5173`. Туннель уже направлен на этот порт. Оба процесса —
`npm run dev` и `npm run tunnel` — должны продолжать работать.

Vite разрешает домены `*.ngrok-free.app`, `*.ngrok-free.dev`, `*.ngrok.app`,
`*.ngrok.io` и `*.trycloudflare.com`. Свой домен (платный аккаунт, собственный
туннель) добавляется без правки файла:

```powershell
$env:CLUTCH_DEV_ALLOWED_HOSTS = "my-tunnel.example.com"
```

Чужой Host Vite отклоняет ответом «Blocked request. This host is not allowed»,
и по виду это похоже на поломку туннеля. Если он появился — дело в этом списке.

### 5.2.1. Заглушка бесплатного ngrok

Бесплатный ngrok отдаёт вместо страницы предупреждение:

```text
Set and send an ngrok-skip-browser-warning request header with any value.
Or, set and send a custom/non-standard browser User-Agent request header.
Or, please upgrade to any paid ngrok account.
```

**Оба header-совета для Telegram не работают.** Заголовки можно задать своим
запросам (их клиент и так отправляет в dev — см. `TUNNEL_HEADERS` в
`apps/web/src/lib/api.ts`), но первую загрузку страницы делает сам WebView
Telegram, и его заголовками управлять нечем. Поэтому остаётся два пути:

- **Cloudflare Tunnel** — бесплатный и без заглушки, домен `*.trycloudflare.com`
  уже разрешён. Вместо `npm run tunnel`:

  ```powershell
  cloudflared tunnel --url http://localhost:5173
  ```

  Адрес меняется при каждом запуске, как у бесплатного ngrok, и его так же надо
  заново вставлять в BotFather.
- **Платный ngrok** — любой платный план заглушку снимает, домен остаётся за вами
  и в BotFather его достаточно вставить один раз.

В браузере на компьютере заглушку можно просто пройти кнопкой «Visit Site» —
она мешает именно внутри Telegram.

### 5.3. Привязать HTTPS URL к боту

Самый простой официальный вариант — menu button:

1. В `@BotFather` выполните `/setmenubutton`.
2. Выберите тестового бота.
3. Укажите текст кнопки, например `Играть`.
4. Вставьте полный HTTPS URL ngrok.

То же обычно доступно через `/mybots` → нужный бот → `Bot Settings` →
`Menu Button`. Интерфейс BotFather может немного отличаться между версиями.

Для кнопки `Launch app` в профиле настройте у того же бота `Main Mini App` через
BotFather. После этого приложение также можно открывать ссылкой:

```text
https://t.me/BOT_USERNAME?startapp
```

Если бесплатный URL ngrok изменился после перезапуска, обновите URL в BotFather.

### 5.4. Проверить Mini App

1. Откройте личный чат с ботом.
2. Нажмите menu button `Играть` или `Launch app`.
3. Выберите категорию.
4. Запрос start не должен завершаться `401`; на экране профиля должно
   отображаться имя текущего Telegram-пользователя.
5. Закончите матч и дождитесь текста `Результат сохранён.`.

Внутри Telegram отдельно проверьте:

- системную кнопку Back на home, categories, matchmaking, question, hammer и
  result;
- safe areas и отсутствие элементов под системными панелями;
- открытие клавиатуры на open-answer;
- сворачивание Telegram и возврат после нескольких секунд;
- звук и системный silent mode;
- Android и iOS, если доступны оба устройства;
- частоту 60/120 Hz, если телефон позволяет переключение.

## 6. Проверка настоящего асинхронного матча

Нужны две **разные identity**. Telegram на телефоне и Desktop под одним аккаунтом
считаются одним игроком и не подходят для проверки подбора собственного ghost.

Надёжный сценарий на свежей локальной D1:

1. Игрок A открывает приложение и выбирает `geography`.
2. В пустом пуле A должен увидеть источник `Бот`.
3. A завершает законный eligible-run и ждёт `Результат сохранён.`.
4. Игрок B с другим Telegram-аккаунтом открывает того же бота и ту же категорию.
5. B должен увидеть источник `Запись игрока`, имя A и пояснение о сохранённом
   результате.
6. B проходит тот же набор вопросов против записанного результата A.

Run A попадает в ghost pool, только если:

- A сам достиг 100%; или
- был сыгран весь набор без более раннего завершения.

Если бот достиг 100%, пока A остался ниже 100%, раннее поражение A сохраняется,
но получает `ghost_eligible = 0`. Тогда источник `Бот` для игрока B — правильное
поведение, а не ошибка матчмейкинга.

Вместо второго Telegram-аккаунта можно использовать отдельную browser guest-
сессию, например окно InPrivate/Incognito. Это проверяет async-подбор, но не
заменяет Telegram-to-Telegram проверку двух реальных `initData`.

## 7. Просмотр локальной D1

Показать последние матчи:

```powershell
npm exec --workspace @clutch/api -- wrangler d1 execute clutch-db --local --command "SELECT id, player_id, display_name, category, status, progress, correct_count, opponent_run_id, ghost_eligible, created_at, completed_at FROM match_runs ORDER BY created_at DESC LIMIT 20;"
```

Что смотреть:

- `status = completed` после подтверждённого результата;
- `ghost_eligible = 1` у записи, пригодной для пула;
- `opponent_run_id` у матча против сохранённого игрока;
- одинаковую `category` у источника и нового матча;
- разные `player_id` у двух Telegram-аккаунтов.

Полностью очистить только локальные матчи:

```powershell
npm exec --workspace @clutch/api -- wrangler d1 execute clutch-db --local --command "DELETE FROM match_runs;"
```

Это необратимо удаляет локальные run-записи, но не затрагивает remote D1.
Не убирайте `--local`.

## 8. Проверка сохранения и плохой сети

В Chrome DevTools → Network:

1. Начните online-матч при нормальной сети.
2. Перед завершением включите `Offline`.
3. Завершите матч.
4. Result screen должен показать, что сохранение не подтверждено, а не выдавать
   локальный результат за серверный.
5. Верните `Online` и дождитесь retry либо перезагрузите приложение.
6. После валидного ACK должен появиться статус `Результат сохранён.`.

Также проверьте:

- двойной клик по «Начать» не создаёт два активных матча;
- Back во время matchmaking отменяет запрос, а поздний ответ не открывает игру;
- повторная отправка одного completion не удваивает результат;
- terminal 4xx остаётся видимой ошибкой и не уходит в бесконечный retry;
- local practice всегда явно помечена и не увеличивает подтверждённую статистику.

## 9. Частые проблемы

### `npm run dev` не запускается

- Проверьте Node `v22.17.0`.
- Выполните `npm ci`.
- Проверьте, что порты свободны:

```powershell
Get-NetTCPConnection -LocalPort 5173,8787 -ErrorAction SilentlyContinue
```

Остановите конкретный старый процесс по его PID либо выберите другой порт. Не
завершайте все процессы Node вслепую.

### `no such table: match_runs`

Не применены локальные миграции. Выполните команду из раздела 2.3 и перезапустите
Worker.

### В браузере работает, в Telegram получается 401

Обычно причина одна из следующих:

- token в `.dev.vars` принадлежит другому боту;
- Worker не был перезапущен после изменения `.dev.vars`;
- приложение открыто не через Telegram Mini App button;
- `initData` устарел — полностью закройте Mini App и откройте заново;
- системное время компьютера сильно неверно.

Не пытайтесь исправлять это передачей `playerId` с клиента: сервер намеренно
выводит identity только из проверенного `initData` или guest token.

### Telegram показывает старую версию или старый URL

- Полностью закройте WebView и откройте снова.
- Проверьте текущий HTTPS URL в окне ngrok.
- Обновите URL menu button/Main Mini App в BotFather.
- Убедитесь, что `npm run dev` всё ещё работает.

### ngrok показывает 502

Vite на `5173` не запущен или завершился. Сначала откройте
`http://127.0.0.1:5173` на компьютере, затем перезапустите tunnel.

### Vite пишет `Blocked request. This host is not allowed`

Текущий конфиг разрешает `*.ngrok-free.app`. Используйте этот домен либо осознанно
добавьте свой tunnel host в `apps/web/vite.config.ts`.

### Игрок B снова получил бота

Проверьте:

- A дождался `Результат сохранён.`;
- у A `ghost_eligible = 1`;
- A и B выбрали одну категорию;
- A и B имеют разные identity;
- локальная D1 не была очищена и Worker использует то же persist-состояние;
- условия старого run совместимы с текущей версией правил/config.

## 10. Что этот тест не доказывает

Даже полный локальный walkthrough не подтверждает:

- production Cloudflare Worker, Pages, D1, secrets и remote-миграции;
- работу GitHub Actions до первого remote-запуска workflow;
- поведение Telegram Android/iOS на устройствах, которые не проверялись вручную;
- честность публичного рейтинга: клиент пока сообщает время и точность удара;
- редакторскую корректность всех history/languages и спорных geography-вопросов;
- содержание 657 записей пакета «Общих знаний»: оно одобрено владельцем целиком,
  построчной вычитки не было (CONTENT_REVIEW);
- утверждённый production-визуал, спрайты и лицензии всех ассетов;
- восстановление незавершённого матча гонки после закрытия приложения (в соло
  забег продолжается: круги пишутся по мере игры).

Root deploy aliases намеренно отсутствуют. Не применяйте remote D1 migrations и
не делайте deploy без отдельной ручной команды из release runbook, проверенной
production-конфигурации и плана отката.

## 11. Короткий ежедневный сценарий

```powershell
# один раз или после изменения схемы
npm ci
npm exec --workspace @clutch/api -- wrangler d1 migrations apply clutch-db --local

# перед ручным тестом
npm test
npm run test:smoke:local
npm run test:preflight:production

# terminal 1
npm run dev

# terminal 2, только для Telegram
npm run tunnel
```

Затем:

1. Browser smoke на `127.0.0.1:5173`.
2. Telegram smoke через menu button.
3. Один eligible-run игрока A.
4. Подбор `Запись игрока` для B.
5. Проверка `Результат сохранён.` и строки в локальной D1.
6. Mobile/keyboard/background/offline walkthrough.
