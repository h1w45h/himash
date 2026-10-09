import asyncio
import logging

from aiogram import Bot
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError

from bot import texts
from bot.config import Config
from bot.db import Database
from bot.keyboards import plans_keyboard

log = logging.getLogger(__name__)


async def _notify(bot: Bot, user_id: int, text: str, config: Config) -> None:
    try:
        await bot.send_message(user_id, text, reply_markup=plans_keyboard(config.plans))
    except (TelegramForbiddenError, TelegramBadRequest):
        # Пользователь заблокировал бота или не начинал диалог.
        pass


async def check_subscriptions(bot: Bot, db: Database, config: Config) -> None:
    for user_id, expires in await db.due_reminders(config.remind_days_before):
        await _notify(
            bot, user_id, f"Подписка заканчивается {texts.fmt_date(expires)}. Продлите, чтобы не потерять доступ.", config
        )
        await db.mark_reminded(user_id)

    for user_id in await db.due_kicks():
        if user_id in config.admin_ids:
            await db.mark_kicked(user_id)
            continue
        try:
            await bot.ban_chat_member(config.channel_id, user_id)
            await bot.unban_chat_member(config.channel_id, user_id, only_if_banned=True)
        except TelegramBadRequest as e:
            # Например, пользователя уже нет в канале.
            log.info("Кик %s: %s", user_id, e)
        await db.mark_kicked(user_id)
        log.info("Подписка %s истекла, удалён из канала", user_id)
        await _notify(bot, user_id, "Подписка закончилась, доступ к каналу закрыт. Продлить можно здесь:", config)


async def run_lifecycle(bot: Bot, db: Database, config: Config) -> None:
    while True:
        try:
            await check_subscriptions(bot, db, config)
        except Exception:
            # Сетевые ошибки и т.п.: попробуем снова на следующем круге.
            log.exception("Ошибка проверки подписок")
        await asyncio.sleep(config.check_interval_seconds)
