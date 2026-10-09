from datetime import timedelta

from aiogram import Bot

from bot.db import utcnow


async def make_invite_link(bot: Bot, channel_id: int, user_id: int) -> str:
    """Ссылка с заявкой на вступление: бот одобряет заявку, только если подписка активна."""
    link = await bot.create_chat_invite_link(
        chat_id=channel_id,
        name=f"user {user_id}",
        expire_date=utcnow() + timedelta(days=1),
        creates_join_request=True,
    )
    return link.invite_link
