# Clutch для Google Play и App Store

Оболочка на [Capacitor](https://capacitorjs.com/). Своего кода игры здесь нет: приложение
показывает ту же сборку `apps/web/dist`, что и Telegram Mini App, и ходит в тот же API.

## Сборка Android

Нужно один раз: Android Studio (вместе с Android SDK) и JDK 21.

```powershell
$env:VITE_API_URL = 'https://clutch-api-prod.kettikteam-official.workers.dev'
npm run mobile:android          # сборка веба + копирование в android/
npm run android --workspace @clutch/mobile   # открыть проект в Android Studio
```

Из Android Studio приложение запускается на телефоне или эмуляторе. Подписанный `.aab` для
Google Play собирается там же: Build → Generate Signed Bundle. Ключ подписи хранить вне репозитория.

## Что уже работает вне Telegram

- Вход гостем; токен продлевается до года после истечения, прогресс не теряется.
- Удаление аккаунта в «Профиле» (требование обоих магазинов).
- Имя гостя задаёт сервер («Игрок xxxx»): свободного текста в рейтингах нет.
- Системная «Назад» на Android: из разделов - на главную, во время забега не закрывает приложение.

## Что ещё нужно до публикации

- `appId` в `capacitor.config.json` (`com.kettikteam.clutch`): после первой публикации его не сменить.
- Вход через Google и Apple, перенос гостевого прогресса в аккаунт.
- Пуш-уведомления (FCM / APNs) вместо сообщений бота.
- «Поделиться» через системный диалог вместо Telegram.
- Политика конфиденциальности, иконки, экран загрузки, скриншоты.
- iOS: `npx cap add ios` и сборка на macOS (свой Mac или облачная сборка).
