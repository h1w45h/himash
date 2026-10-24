# Настройка авторизации (Clerk)

1. Создайте приложение в Clerk, включите: Email + пароль (с кодом подтверждения), Google, Apple.
2. **VK**: Clerk → User & Authentication → SSO connections → *Add custom provider*, ключ `vk`
   (стратегия на клиенте — `oauth_custom_vk`). Client ID/Secret берутся из vk.com/apps (тип «Веб-сайт»),
   Redirect URL — из панели Clerk.
3. Переменные:
   * сервер (`apps/server/.env`): `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER`, `CLERK_WEBHOOK_SECRET`;
   * мобильное приложение (`apps/mobile/.env`): `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_API_URL`.
4. Вебхук Clerk → `POST {API}/webhooks/clerk`, события `user.created`, `user.deleted`.
5. Apple Sign-In на iOS требует dev-сборки (`eas build --profile development`), Expo Go не подходит.

Профиль в нашей БД создаётся лениво при первом запросе с валидным JWT (`AuthService.provision`),
вебхук — резервный путь. Новому игроку начисляется 500 монет.

## Локальный режим без Clerk
Если `CLERK_SECRET_KEY` пуст (и не production) или задан `DEV_AUTH=true`, сервер принимает токены `dev:<ник>`
(3–16 символов: латиница, цифры, `_`) и создаёт профиль с 500 монетами. Мобильное приложение переключается в этот режим,
когда не задан `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`: экран входа показывает поле ника. **Не включайте `DEV_AUTH` в боевой среде** —
любой может войти под любым ником.
