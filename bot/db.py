from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    user_id     INTEGER PRIMARY KEY,
    username    TEXT,
    full_name   TEXT,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
    user_id      INTEGER PRIMARY KEY REFERENCES users(user_id),
    expires_at   TEXT NOT NULL,
    reminded_at  TEXT,
    kicked_at    TEXT
);
CREATE TABLE IF NOT EXISTS payments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    plan_code   TEXT NOT NULL,
    stars       INTEGER NOT NULL,
    charge_id   TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    action      TEXT NOT NULL,
    details     TEXT,
    actor_id    INTEGER,
    created_at  TEXT NOT NULL
);
"""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value)


class Database:
    def __init__(self, path: str):
        self.path = path
        self.conn: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = await aiosqlite.connect(self.path)
        self.conn.row_factory = aiosqlite.Row
        await self.conn.executescript(SCHEMA)
        await self.conn.commit()

    async def close(self) -> None:
        if self.conn:
            await self.conn.close()

    async def upsert_user(self, user_id: int, username: str | None, full_name: str, now: datetime | None = None) -> None:
        now = now or utcnow()
        await self.conn.execute(
            """INSERT INTO users (user_id, username, full_name, created_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, full_name = excluded.full_name""",
            (user_id, username, full_name, _iso(now)),
        )
        await self.conn.commit()

    async def get_expires_at(self, user_id: int) -> datetime | None:
        async with self.conn.execute("SELECT expires_at FROM subscriptions WHERE user_id = ?", (user_id,)) as cur:
            row = await cur.fetchone()
        return _parse(row["expires_at"]) if row else None

    async def is_active(self, user_id: int, now: datetime | None = None) -> bool:
        expires = await self.get_expires_at(user_id)
        return expires is not None and expires > (now or utcnow())

    async def _extend(self, user_id: int, days: int, now: datetime) -> datetime:
        current = await self.get_expires_at(user_id)
        base = current if current and current > now else now
        new_expires = base + timedelta(days=days)
        await self.conn.execute(
            """INSERT INTO subscriptions (user_id, expires_at) VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at, reminded_at = NULL, kicked_at = NULL""",
            (user_id, _iso(new_expires)),
        )
        return new_expires

    async def _audit(self, user_id: int | None, action: str, details: str, actor_id: int | None, now: datetime) -> None:
        await self.conn.execute(
            "INSERT INTO audit_log (user_id, action, details, actor_id, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_id, action, details, actor_id, _iso(now)),
        )

    async def record_payment(
        self, user_id: int, plan_code: str, days: int, stars: int, charge_id: str, now: datetime | None = None
    ) -> datetime | None:
        """Записывает оплату и продлевает подписку. Повторный charge_id игнорируется (возвращает None)."""
        now = now or utcnow()
        try:
            await self.conn.execute(
                "INSERT INTO payments (user_id, plan_code, stars, charge_id, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, plan_code, stars, charge_id, _iso(now)),
            )
        except aiosqlite.IntegrityError:
            await self.conn.rollback()
            return None
        expires = await self._extend(user_id, days, now)
        await self._audit(user_id, "payment", f"{plan_code} {stars}⭐ {charge_id} -> {_iso(expires)}", user_id, now)
        await self.conn.commit()
        return expires

    async def grant(self, user_id: int, days: int, actor_id: int, now: datetime | None = None) -> datetime:
        now = now or utcnow()
        expires = await self._extend(user_id, days, now)
        await self._audit(user_id, "grant", f"+{days}d -> {_iso(expires)}", actor_id, now)
        await self.conn.commit()
        return expires

    async def revoke(self, user_id: int, actor_id: int, now: datetime | None = None) -> bool:
        now = now or utcnow()
        cur = await self.conn.execute(
            "UPDATE subscriptions SET expires_at = ? WHERE user_id = ? AND kicked_at IS NULL", (_iso(now), user_id)
        )
        if cur.rowcount:
            await self._audit(user_id, "revoke", "", actor_id, now)
        await self.conn.commit()
        return bool(cur.rowcount)

    async def due_reminders(self, days_before: int, now: datetime | None = None) -> list[tuple[int, datetime]]:
        now = now or utcnow()
        async with self.conn.execute(
            """SELECT user_id, expires_at FROM subscriptions
               WHERE reminded_at IS NULL AND expires_at > ? AND expires_at <= ?""",
            (_iso(now), _iso(now + timedelta(days=days_before))),
        ) as cur:
            return [(r["user_id"], _parse(r["expires_at"])) async for r in cur]

    async def mark_reminded(self, user_id: int, now: datetime | None = None) -> None:
        await self.conn.execute(
            "UPDATE subscriptions SET reminded_at = ? WHERE user_id = ?", (_iso(now or utcnow()), user_id)
        )
        await self.conn.commit()

    async def due_kicks(self, now: datetime | None = None) -> list[int]:
        now = now or utcnow()
        async with self.conn.execute(
            "SELECT user_id FROM subscriptions WHERE kicked_at IS NULL AND expires_at <= ?", (_iso(now),)
        ) as cur:
            return [r["user_id"] async for r in cur]

    async def mark_kicked(self, user_id: int, now: datetime | None = None) -> None:
        now = now or utcnow()
        await self.conn.execute("UPDATE subscriptions SET kicked_at = ? WHERE user_id = ?", (_iso(now), user_id))
        await self._audit(user_id, "kick", "подписка истекла", None, now)
        await self.conn.commit()

    async def active_user_ids(self, now: datetime | None = None) -> list[int]:
        async with self.conn.execute(
            "SELECT user_id FROM subscriptions WHERE expires_at > ?", (_iso(now or utcnow()),)
        ) as cur:
            return [r["user_id"] async for r in cur]
