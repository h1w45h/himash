from datetime import timedelta
from unittest.mock import AsyncMock

from bot.config import Config, parse_plans
from bot.db import Database, utcnow
from bot.lifecycle import check_subscriptions


def make_config():
    return Config("t", -100, frozenset({42}), parse_plans("week:7:250:Неделя"), 3, 600, ":memory:")


async def test_expired_user_is_kicked_once():
    db = Database(":memory:")
    await db.connect()
    past = utcnow() - timedelta(days=10)
    await db.record_payment(1, "week", 7, 250, "ch1", past)
    bot = AsyncMock()
    config = make_config()

    await check_subscriptions(bot, db, config)
    bot.ban_chat_member.assert_awaited_once_with(-100, 1)
    bot.unban_chat_member.assert_awaited_once_with(-100, 1, only_if_banned=True)

    bot.reset_mock()
    await check_subscriptions(bot, db, config)
    bot.ban_chat_member.assert_not_awaited()
    await db.close()


async def test_expiring_user_gets_one_reminder():
    db = Database(":memory:")
    await db.connect()
    await db.record_payment(1, "week", 7, 250, "ch1", utcnow() - timedelta(days=5))
    bot = AsyncMock()
    config = make_config()

    await check_subscriptions(bot, db, config)
    assert bot.send_message.await_count == 1
    bot.ban_chat_member.assert_not_awaited()

    await check_subscriptions(bot, db, config)
    assert bot.send_message.await_count == 1
    await db.close()
