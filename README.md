# Настолки Онлайн

Кроссплатформенное (iOS + Android) приложение с настольными играми: онлайн, против бота и на одном устройстве.
React Native + Expo + TypeScript · NestJS · PostgreSQL + Prisma · Redis · Socket.io · Clerk.

Документация: [архитектура](docs/ARCHITECTURE.md) · [экраны](docs/SCREENS.md) · [реал-тайм протокол](docs/REALTIME.md) ·
[авторизация](docs/AUTH.md) · [добавление игр](docs/GAMES.md) · [план](docs/ROADMAP.md).

## Быстрый старт

Нужны: Node 20+, Docker (или локальные Postgres 16 и Redis 7), аккаунт Clerk ([настройка](docs/AUTH.md)).

```bash
npm install
docker run -d --name pg    -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=nastolki postgres:16
docker run -d --name redis -p 6379:6379 redis:7

cp apps/server/.env.example apps/server/.env      # DATABASE_URL, REDIS_URL, ключи Clerk
cp apps/mobile/.env.example apps/mobile/.env      # EXPO_PUBLIC_API_URL, EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
npx prisma migrate deploy --schema apps/server/prisma/schema.prisma
npm run prisma:seed -w @nastolki/server           # каталог игр

npm run dev:server                                # http://localhost:3000/health
npm run dev:mobile                                # Expo; для Apple Sign-In, MMKV и push нужна dev-сборка (eas build --profile development)
```

## Проверки

```bash
npm run typecheck
npm test                                          # юнит-тесты движков, рейтинга, матчмейкинга
# Интеграционные тесты сервера (Postgres + Redis, сокеты, push-заглушка):
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nastolki REDIS_URL=redis://localhost:6379 \
  npm test -w @nastolki/server
```

## Что готово

| Область | Состояние |
|---|---|
| Авторизация (email, Google, Apple, VK через Clerk), профиль, настройки | ✅ |
| Каталог из 21 игры с правилами на русском, оффлайн-кэш | ✅ |
| Комнаты (код, пароль, приватность), приглашения, матчмейкинг на Redis | ✅ |
| Реал-тайм: ходы с версиями, реконнект, таймеры, боты, чат, присутствие | ✅ |
| Рейтинг Glicko-2, награды, лидерборды, история партий | ✅ |
| Друзья, блокировки, личные сообщения, push-уведомления, центр уведомлений | ✅ |
| Игры: Шахматы, Шашки, Го (9/13/19), Свинтус, Мафия, Кодовые имена, Элиас, Бункер, Диксит, Имаджинариум, Азул, Ticket to Ride, Колонизаторы, Каркассон, Нарды (длинные), Покер (Холдем), Дурак (2 варианта), Uno, Монополия | ✅ BETA |
| Оффлайн: игра с ботом и на одном устройстве с автосохранением | ✅ |
| Остальные 2 игры каталога | ⏳ см. [план](docs/ROADMAP.md) |
| Магазин за монеты (аватары, доски, рубашки, темы), ежедневный бонус, 17 достижений с наградами | ✅ |
| Турниры (олимпийская сетка 4–32, взносы и призы, закрытые по коду, автостарт/отмена) для шахмат и шашек | ✅ |
| Покупки за кристаллы (IAP) | ⏳ нужны ключи магазинов приложений |
| Звуки (нужны аудиоассеты), синхронизация оффлайн-партий | ⏳ |
