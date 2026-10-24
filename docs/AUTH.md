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
