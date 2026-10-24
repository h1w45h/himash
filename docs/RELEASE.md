# Публикация в App Store и Google Play

Код, сборка (EAS) и CI готовы. Шаги ниже требуют **ваших аккаунтов и платёжных данных** — их нельзя выполнить за вас.

## 1. Один раз (≈ 1–2 часа + ожидание проверок)
1. Аккаунты разработчика: Apple Developer Program (99 $/год), Google Play Console (25 $ разово).
2. Clerk (production-инстанс): ключи, Google/Apple/VK — [AUTH.md](AUTH.md). Для Apple Sign-In включите capability в App ID.
3. Сервер: Railway → New Project из репозитория (`railway.json`), добавьте Postgres и Redis, переменные
   `DATABASE_URL`, `REDIS_URL`, `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER`, `CLERK_WEBHOOK_SECRET`, `SUPPORT_EMAIL`. Не задавайте `DEV_AUTH`.
   Привяжите домен (например `api.nastolki.online`); страницы `/privacy`, `/terms`, `/support` уже отдаются сервером.
4. Expo: `npm i -g eas-cli && eas login && cd apps/mobile && eas init`, затем `eas credentials` (ключи iOS/Android создаст EAS).
5. GitHub → Settings → Secrets: `EXPO_TOKEN`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`; Variables: `EXPO_PUBLIC_API_URL` (https-адрес сервера).
6. Карточки в магазинах — тексты и ответы анкет в [STORE_LISTING.md](STORE_LISTING.md); скриншоты снимите с dev-сборки (6.7" iPhone, 6.5"/5.5", телефон Android).
7. Для отправки: App Store Connect → создать приложение `online.nastolki.app`; Play Console → создать приложение и загрузить первый AAB вручную
   (дальше `eas submit` работает сам, нужен сервисный JSON-ключ Google API).

## 2. Каждый релиз
```bash
git tag v0.1.0 && git push --tags     # CI: проверки → eas build all → автоотправка (Play: internal draft, iOS: TestFlight)
```
Сначала TestFlight / internal testing, затем production после проверки на реальных устройствах.

## 3. Чего ещё нет до публичного релиза
- Покупки за кристаллы (RevenueCat/StoreKit/Billing) — до их появления кристаллы в магазине не продаются.
- Проверка на реальных устройствах и эмуляторах: сборка бандла проходит, но запуск в приложении не прогонялся.
- Нагрузочные тесты сервера, мониторинг (Sentry) и резервные копии БД.
