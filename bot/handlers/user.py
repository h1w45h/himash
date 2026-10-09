from aiogram import Bot, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import Message

from bot import texts
from bot.config import Config
from bot.db import Database
from bot.invites import make_invite_link
from bot.keyboards import plans_keyboard

router = Router()
router.message.filter(F.chat.type == "private")


@router.message(CommandStart())
async def start(message: Message, db: Database, config: Config) -> None:
    user = message.from_user
    await db.upsert_user(user.id, user.username, user.full_name)
    expires = await db.get_expires_at(user.id)
    status = (
        f"Подписка активна до {texts.fmt_date(expires)}."
        if await db.is_active(user.id)
        else texts.NO_SUB
    )
    await message.answer(
        f"{texts.WELCOME}\n\n{status}\n\n{texts.plans_text(config.plans)}",
        reply_markup=plans_keyboard(config.plans),
    )


@router.message(Command("status"))
async def status(message: Message, db: Database, config: Config) -> None:
    expires = await db.get_expires_at(message.from_user.id)
    if expires and await db.is_active(message.from_user.id):
        await message.answer(f"Подписка активна до {texts.fmt_date(expires)}.")
    else:
        await message.answer(f"{texts.NO_SUB}\n\n{texts.plans_text(config.plans)}", reply_markup=plans_keyboard(config.plans))


@router.message(Command("link"))
async def link(message: Message, bot: Bot, db: Database, config: Config) -> None:
    if not await db.is_active(message.from_user.id):
        await message.answer(texts.NO_SUB, reply_markup=plans_keyboard(config.plans))
        return
    url = await make_invite_link(bot, config.channel_id, message.from_user.id)
    await message.answer(f"Ссылка в канал (действует сутки): {url}")


@router.message(Command("help"))
async def help_(message: Message, config: Config) -> None:
    text = texts.HELP
    if message.from_user.id in config.admin_ids:
        text += "\n\n" + texts.ADMIN_HELP
    await message.answer(text)
