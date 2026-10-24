#!/bin/sh
# Первичная настройка: зависимости, .env, миграции и справочники. Нужны запущенные Postgres и Redis (docker compose up -d).
set -e
cd "$(dirname "$0")/.."
npm install
[ -f apps/server/.env ] || cp apps/server/.env.example apps/server/.env
[ -f apps/mobile/.env ] || cp apps/mobile/.env.example apps/mobile/.env
npm run prisma:generate -w @nastolki/server
npm run prisma:deploy -w @nastolki/server
npm run prisma:seed -w @nastolki/server
echo "Готово. Сервер: npm run dev:server, приложение: npm run dev:mobile"
