# Реал-тайм протокол (Socket.io, неймспейс `/game`)

Подключение: `io(API_URL + '/game', { auth: { token: <JWT Clerk> } })`. Без валидного токена — `connect_error: UNAUTHORIZED`.
Каждое событие клиента → сервер возвращает ack: `{ ok: true, data } | { ok: false, code, message }`,
коды: `STALE | INVALID | FORBIDDEN | NOT_FOUND | RATE_LIMIT`.

| Клиент → сервер | Тело | Ответ (`data`) |
|---|---|---|
| `room:join` / `room:leave` | `{ code }` | представление комнаты |
| `match:resync` | `{ matchId, sinceVersion? }` | `MatchSnapshot` (вход в партию и каждый реконнект) |
| `match:action` | `{ matchId, expectedVersion, action }` | `{ version }` |
| `match:resign` | `{ matchId }` | — |
| `chat:send` | `{ scope: 'ROOM'\|'MATCH', target, body }` | `ChatMessageDto` |

| Сервер → клиент | Когда |
|---|---|
| `room:updated`, `room:closed` | изменения в комнате (канал `room:<id>`) |
| `match:started`, `mm:found`, `invite:received` | личный канал `user:<id>` |
| `match:update` | после каждого хода: полный `view` места + `legal` + `lastAction` (через `redactAction`) |
| `match:ended` | то же, что `match:update`, при завершении партии |
| `chat:message` | новое сообщение комнаты/партии |

## Гарантии
* Ходы партии сериализуются Redis-блокировкой; состояние + запись в `MatchMove` + итоги — одна транзакция БД.
* `expectedVersion` ≠ версии партии → `STALE`, а клиенту сразу прилетает актуальный снимок.
* Скрытая информация: каждое место получает собственный `view` (канал `match:<id>:seat:<n>`).
* Таймер хода: просрочка → `timeoutAction` игры, иначе поражение (вдвоём) / замена ботом (втроём+) / отмена.
* Сдача и выход: вдвоём — победа соперника; втроём+ место занимает бот.
* Рейтинг Glicko-2 и монеты начисляются только в партиях без ботов с минимум двумя живыми игроками; награда идемпотентна.
* Несколько инстансов сервера: `@socket.io/redis-adapter`, блокировки и тикеры — через Redis.
