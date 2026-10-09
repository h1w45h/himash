from aiogram import Bot, F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import Message

from bot import texts
from bot.config import Config
from bot.db import Database

router = Router()


def setup_admin_filter(config: Config) -> None:
    router.message.filter(F.chat.type == "private", F.from_user.id.in_(config.admin_ids))


@router.message(Command("grant"))
async def grant(message: Message, command: CommandObject, db: Database) -> None:
    try:
        user_id, days = (int(x) for x in (command.args or "").split())
    except ValueError:
        await message.answer("Формат: /grant <user_id> <дней>")
        return
    expires = await db.grant(user_id, days, actor_id=message.from_user.id)
    await message.answer(f"Пользователю {user_id} подписка до {texts.fmt_date(expires)}.")


@router.message(Command("revoke"))
async def revoke(message: Message, command: CommandObject, db: Database) -> None:
    try:
        user_id = int((command.args or "").strip())
    except ValueError:
        await message.answer("Формат: /revoke <user_id>")
        return
    if await db.revoke(user_id, actor_id=message.from_user.id):
        await message.answer(f"Подписка {user_id} отключена, удалю из канала при следующей проверке.")
    else:
        await message.answer("Активной подписки у этого пользователя нет.")


@router.message(Command("signal"))
async def signal(message: Message, command: CommandObject, bot: Bot, config: Config) -> None:
    if message.reply_to_message:
        await bot.copy_message(config.channel_id, message.chat.id, message.reply_to_message.message_id)
    elif command.args:
        await bot.send_message(config.channel_id, command.args)
    else:
        await message.answer("Напишите /signal <текст> или ответьте /signal на сообщение.")
        return
    await message.answer("Сигнал отправлен в канал ✅")
