# Сборка из корня монорепозитория: docker build -f apps/server/Dockerfile -t nastolki-server .
FROM node:20-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN npm ci --workspace @nastolki/server --include-workspace-root && npx prisma generate --schema apps/server/prisma/schema.prisma
ENV NODE_ENV=production
EXPOSE 3000
# Миграции и справочники применяются при старте, затем запускается сервер
CMD ["sh", "-c", "cd apps/server && npx prisma migrate deploy && node -r @swc-node/register prisma/seed.ts && node -r @swc-node/register src/main.ts"]
