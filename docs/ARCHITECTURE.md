# Настолки Онлайн — архитектура

## 1. Решения по стеку (фиксированы)

| Слой | Выбор | Почему |
|---|---|---|
| Мобильное приложение | Expo SDK 52+, Expo Router, TypeScript | Одна кодовая база iOS/Android, файловая навигация |
| Состояние | Zustand (клиентское/игровое), React Query (серверное) | Чёткое разделение «кэш сервера» и «локальное состояние» |
| Анимации | Reanimated 3 + Gesture Handler + Skia (доска Го/Catan) | 60 fps на UI-потоке |
| Backend | **NestJS** (модули, DI, гварды, Gateway) | Socket.io Gateway и модульность под каталог игр |
| БД | PostgreSQL + Prisma | Реляционная модель + JSON-снапшоты партий |
| Кэш / realtime | Redis (presence, очереди матчмейкинга, адаптер Socket.io, блокировки) | Горизонтальное масштабирование WebSocket |
| Realtime | Socket.io | Комнаты, ack, авто-реконнект |
| Авторизация | **Clerk** (email, Google, Apple, VK через OAuth custom provider) | Готовые провайдеры, JWT проверяется на бэкенде |
| Деплой | EAS Build/Submit/Update; сервер — Railway (Postgres+Redis плагины) | |

## 2. Ключевая идея: единый игровой движок

Каждая игра — **чистая детерминированная функция состояния** в общем пакете `@nastolki/game-engine`.
Один и тот же код работает:

* на **сервере** — авторитетная валидация ходов (анти-чит, скрытая информация);
* на **клиенте** — оффлайн (pass-and-play, бот), оптимистичные ходы онлайн;
* в **ботах** — перебор ходов.

```ts
interface GameDefinition<State, Action, Options = unknown> {
  slug: string;                              // 'chess'
  minPlayers: number; maxPlayers: number;
  setup(ctx: SetupCtx<Options>): State;      // seed → начальное состояние
  legalActions(state: State, seat: Seat): Action[];
  validate(state: State, seat: Seat, a: Action): Result;
  apply(state: State, seat: Seat, a: Action, rng: Rng): State; // без побочных эффектов
  currentSeats(state: State): Seat[];        // кто может ходить (одновременные ходы в Мафии)
  outcome(state: State): Outcome | null;     // победители/ничья
  view(state: State, seat: Seat): PlayerView; // скрытая информация: чужие карты удаляются
  bot?: BotStrategy<State, Action>;
}
```

Добавление новой игры = новая папка в `packages/game-engine/src/games/<slug>` + запись в реестре
`registry.ts` + UI-компонент `apps/mobile/src/games/<slug>` + seed-запись в `Game`. Остальное (комнаты,
матчмейкинг, рейтинг, чат, магазин) работает без изменений.

**Скрытая информация.** Сервер хранит полный `state`, клиенту отправляет только `view(state, seat)`.
**Случайность.** `Rng` — seeded (mulberry32) от `Match.seed`; ход можно воспроизвести из журнала.

## 3. Общая схема

```
┌──────────────────────── Expo App (iOS / Android) ────────────────────────┐
│ Expo Router ── screens ── game UIs (Reanimated/Skia)                       │
│ Zustand: auth, settings, activeGame, offline queue │ React Query: REST      │
│ game-engine (shared) ← локальные/бот игры работают без сети (MMKV/SQLite)  │
│ Socket.io client: auto-reconnect, resync по stateVersion                   │
└───────────────┬───────────────────────────────┬────────────────────────────┘
        HTTPS REST (JWT Clerk)            WSS Socket.io (JWT в handshake)
┌───────────────▼───────────────────────────────▼────────────────────────────┐
│ NestJS                                                                      │
│  Auth │ Users │ Friends │ Games │ Rooms │ Matchmaking │ Matches │ Chat      │
│  Ratings │ Achievements │ Tournaments │ Shop │ Notifications │ Bots         │
│  Realtime Gateway (/game, /social)   ← использует game-engine               │
└───────┬───────────────────────┬──────────────────────┬────────────────────┘
   PostgreSQL (Prisma)     Redis                  Expo Push API / Clerk webhooks
```

### Realtime-протокол (кратко)

* Неймспейсы: `/game` (комнаты и партии), `/social` (presence, друзья, DM, приглашения).
* Клиент → сервер: `room:join`, `room:ready`, `match:action {matchId, expectedVersion, action}`,
  `match:resync {matchId, sinceVersion}`, `chat:send`.
* Сервер → клиент: `match:update {version, action, view}`, `match:turn {seat, deadline}`,
  `match:ended`, `room:updated`, `presence:update`.
* Ack на каждое действие; при `expectedVersion != state.version` сервер отвечает `STALE` + актуальным `view`.
* Блокировка на партию через Redis (`SET match:lock:<id> NX PX 2000`) — ходы сериализуются.
* Реконнект: клиент присылает `resync` с последней версией → сервер отдаёт недостающие ходы (из `MatchMove`)
  или полный `view`.
* Таймауты ходов: Redis sorted set `turn:deadlines` + воркер; по истечении — авто-ход/пропуск/техпоражение.

### Матчмейкинг

Очередь Redis `mm:<game>:<variant>` (sorted set по рейтингу). Воркер раз в секунду расширяет окно
рейтинга (±100 → ±400 за 30 с), собирает `minPlayers..maxPlayers`, создаёт `Room` + `Match`
и шлёт обоим `mm:found`. Для >2 игроков — ожидание набора с минимальным кворумом и таймером.

### Рейтинг

Glicko-2 для двухсторонних игр; для многопользовательских — попарное усреднение по местам.
Рейтинг пересчитывается в транзакции вместе с закрытием матча; награда монетами — с `idempotencyKey`.

### Оффлайн

* Pass-and-play и боты: полностью на клиенте, состояние в MMKV, автосохранение после каждого хода.
* По возвращении сети очередь `pendingMatches` отправляется на `POST /matches/sync`
  (сервер переигрывает журнал ходов через game-engine и принимает результат; рейтинг не меняется).
* Каталог игр и правила кэшируются React Query persister → доступны без сети.

### Безопасность

JWT Clerk проверяется в `AuthGuard` и в Socket.io middleware; rate-limit (Nest Throttler + Redis);
валидация DTO (zod); чат — фильтр нецензурной лексики, жалобы, блокировки; IAP-квитанции проверяются
на сервере; все денежные операции — идемпотентные транзакции.

## 4. Структура репозитория (npm workspaces + Turborepo)

```
himash/
├─ package.json                 # workspaces: apps/*, packages/*
├─ turbo.json  tsconfig.base.json  .eslintrc.cjs  .prettierrc
├─ docs/                        # ARCHITECTURE, SCREENS, ROADMAP
├─ packages/
│  ├─ game-engine/              # чистая TS-логика игр (без зависимостей от RN/Node)
│  │  └─ src/
│  │     ├─ core/               # types.ts, rng.ts, registry.ts, runner.ts
│  │     ├─ bots/               # minimax, MCTS, эвристики
│  │     └─ games/
│  │        ├─ chess/  checkers/  backgammon/  go/
│  │        ├─ durak/  poker/  preferans/  uno/  svintus/
│  │        ├─ monopoly/  catan/  carcassonne/  ticket-to-ride/  azul/  munchkin/
│  │        └─ mafia/  bunker/  codenames/  alias/  dixit/  imaginarium/
│  └─ shared/                   # DTO (zod), события сокетов, константы, ru-строки правил
├─ apps/
│  ├─ server/                   # NestJS
│  │  ├─ prisma/ (schema.prisma, seed.ts, migrations/)
│  │  └─ src/
│  │     ├─ main.ts  app.module.ts
│  │     ├─ common/ (guards, filters, decorators, redis, throttler)
│  │     └─ modules/
│  │        auth  users  friends  games  rooms  matchmaking  matches
│  │        realtime  chat  ratings  achievements  tournaments  shop
│  │        notifications  bots  reports
│  └─ mobile/                   # Expo
│     ├─ app.config.ts  eas.json
│     ├─ app/                   # Expo Router
│     │  ├─ _layout.tsx
│     │  ├─ (auth)/ sign-in, sign-up, forgot
│     │  ├─ (tabs)/ index, games, play, friends, profile
│     │  ├─ game/[slug]/ index, setup
│     │  ├─ room/[code].tsx  match/[id].tsx  local/[slug].tsx  bot/[slug].tsx
│     │  ├─ tournament/ index, [id]
│     │  ├─ shop/  chat/[id]  user/[id]  settings/
│     └─ src/
│        ├─ api/ (client, hooks на React Query)
│        ├─ realtime/ (socket.ts, useMatch.ts)
│        ├─ stores/ (auth, settings, localMatch, queue — Zustand)
│        ├─ games/<slug>/ (Board.tsx, Hud.tsx, assets)
│        ├─ components/ (ui kit)  theme/ (light, dark, tokens)
│        ├─ services/ (sound, haptics, push, storage)
│        └─ i18n/ (ru.ts — единственная локаль, строки вынесены)
└─ .github/workflows/ (ci.yml, eas-build.yml, deploy-server.yml)
```

## 5. Тестирование и качество

* game-engine: property-based (fast-check) + перфт-тесты для шахмат, сценарные тесты правил.
* Сервер: Jest + Testcontainers (Postgres/Redis), e2e Socket.io.
* Клиент: Jest + RNTL, Maestro для e2e.
* CI: lint, typecheck, test, prisma validate, EAS preview build на PR.
