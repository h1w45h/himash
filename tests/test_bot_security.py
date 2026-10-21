import pytest

from app.bot.security import RateLimiter, is_allowed
from app.integrity.registry import add_item, render_for_match
from app.storage.db import Database


def test_allowlist_fails_closed():
    assert not is_allowed(1, set())
    assert not is_allowed(None, {1})
    assert is_allowed(1, {1})


def test_rate_limit():
    rl = RateLimiter(2)
    assert rl.allow(1, 0) and rl.allow(1, 1) and not rl.allow(1, 2) and rl.allow(1, 61.5)


def test_notification_idempotent():
    db = Database(":memory:")
    assert db.claim_notification(1, "m", "goal:1-0", "v1")
    assert not db.claim_notification(1, "m", "goal:1-0", "v1")
    db.release_notification(1, "m", "goal:1-0", "v1")
    assert db.claim_notification(1, "m", "goal:1-0", "v1")


def test_integrity_requires_https_and_review():
    db = Database(":memory:")
    with pytest.raises(ValueError):
        add_item(db, status="official_investigation", source_url="http://x.org/a", publisher="P",
                 subject="S", competition="C", summary="s", source_type="press")
    with pytest.raises(ValueError):
        add_item(db, status="guilty", source_url="https://x.org/a", publisher="P",
                 subject="S", competition="C", summary="s", source_type="press")
    add_item(db, status="official_investigation", source_url="https://x.org/a", publisher="P",
             subject="Club", competition="C", summary="Investigation announced.", source_type="federation")
    # unreviewed items are never shown
    assert "No reviewed" in render_for_match(db, ["Club"], "C")
    db.conn.execute("UPDATE integrity_item SET review_state='approved'")
    out = render_for_match(db, ["Club"], "C")
    assert "NOT a finding of guilt" in out


async def test_handler_denies_unlisted_user_and_serves_allowed():
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from app.bot.bot import FesiBot
    from app.config import Settings
    from app.forecast import ForecastService

    s = Settings(telegram_allowed_user_ids="7")
    bot = FesiBot(s, ForecastService(s, None, None, Database(":memory:")), Database(":memory:"))

    def upd(uid):
        return SimpleNamespace(effective_user=SimpleNamespace(id=uid), message=SimpleNamespace(reply_text=AsyncMock()))
    bad, good = upd(8), upd(7)
    await bot.today(bad, SimpleNamespace(args=[]))
    assert "Access denied" in bad.message.reply_text.call_args[0][0]
    await bot.today(good, SimpleNamespace(args=[]))
    assert "No football data provider configured" in good.message.reply_text.call_args[0][0]
