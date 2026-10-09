import logging

from aiogram import Bot, F, Router
from aiogram.filters import JOIN_TRANSITION, ChatMemberUpdatedFilter
from aiogram.types import ChatJoinRequest, ChatMemberUpdated

from bot.config import Config
from bot.db import Database

router = Router()
log = logging.getLogger(__name__)


@router.chat_join_request()
async def join_request(request: ChatJoinRequest, db: Database, config: Config) -> None:
    if request.chat.id != config.channel_id:
        return
    if await db.is_active(request.from_user.id):
        await request.approve()
    else:
        await request.decline()


@router.chat_member(ChatMemberUpdatedFilter(JOIN_TRANSITION))
async def joined_without_subscription(event: ChatMemberUpdated, bot: Bot, db: Database, config: Config) -> None:
    """Если кто-то попал в канал в обход бота (старая ссылка и т.п.), убираем его."""
    user_id = event.new_chat_member.user.id
    if event.chat.id != config.channel_id or user_id in config.admin_ids or event.new_chat_member.user.is_bot:
        return
    if await db.is_active(user_id):
        return
    log.info("Пользователь %s вошёл в канал без подписки, удаляю", user_id)
    await bot.ban_chat_member(config.channel_id, user_id)
    await bot.unban_chat_member(config.channel_id, user_id, only_if_banned=True)
