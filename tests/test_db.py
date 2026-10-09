from datetime import datetime, timedelta, timezone

import pytest

from bot.db import Database

NOW = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
async def db():
    database = Database(":memory:")
    await database.connect()
    await database.upsert_user(1, "u", "User", NOW)
    yield database
    await database.close()


async def test_payment_activates_and_stacks(db):
    expires = await db.record_payment(1, "month", 30, 750, "ch1", NOW)
    assert expires == NOW + timedelta(days=30)
    assert await db.is_active(1, NOW)
    # Продление до окончания прибавляется к текущему сроку
    expires = await db.record_payment(1, "week", 7, 250, "ch2", NOW + timedelta(days=5))
    assert expires == NOW + timedelta(days=37)


async def test_duplicate_charge_ignored(db):
    assert await db.record_payment(1, "month", 30, 750, "ch1", NOW)
    assert await db.record_payment(1, "month", 30, 750, "ch1", NOW) is None
    assert await db.get_expires_at(1) == NOW + timedelta(days=30)


async def test_renewal_after_expiry_starts_from_now(db):
    await db.record_payment(1, "week", 7, 250, "ch1", NOW)
    later = NOW + timedelta(days=20)
    expires = await db.record_payment(1, "week", 7, 250, "ch2", later)
    assert expires == later + timedelta(days=7)


async def test_reminder_and_kick_flow(db):
    await db.record_payment(1, "week", 7, 250, "ch1", NOW)
    assert await db.due_reminders(3, NOW) == []
    day5 = NOW + timedelta(days=5)
    assert [u for u, _ in await db.due_reminders(3, day5)] == [1]
    await db.mark_reminded(1, day5)
    assert await db.due_reminders(3, day5) == []

    assert await db.due_kicks(day5) == []
    day8 = NOW + timedelta(days=8)
    assert await db.due_kicks(day8) == [1]
    assert not await db.is_active(1, day8)
    await db.mark_kicked(1, day8)
    assert await db.due_kicks(day8) == []


async def test_payment_resets_kick_and_reminder(db):
    await db.record_payment(1, "week", 7, 250, "ch1", NOW)
    day8 = NOW + timedelta(days=8)
    await db.mark_reminded(1, day8)
    await db.mark_kicked(1, day8)
    await db.record_payment(1, "week", 7, 250, "ch2", day8)
    assert await db.is_active(1, day8)
    assert [u for u, _ in await db.due_reminders(7, day8)] == [1]
    assert await db.due_kicks(day8 + timedelta(days=8)) == [1]


async def test_grant_and_revoke(db):
    await db.grant(1, 10, actor_id=99, now=NOW)
    assert await db.is_active(1, NOW)
    assert await db.revoke(1, actor_id=99, now=NOW)
    assert not await db.is_active(1, NOW + timedelta(seconds=1))
    assert await db.due_kicks(NOW) == [1]
    async with db.conn.execute("SELECT action FROM audit_log ORDER BY id") as cur:
        assert [r["action"] async for r in cur] == ["grant", "revoke"]
