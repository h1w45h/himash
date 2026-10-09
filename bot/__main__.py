import asyncio
import logging

from aiogram import Bot, Dispatcher

from bot.config import load_config
from bot.db import Database
from bot.handlers import admin, build_router
from bot.lifecycle import run_lifecycle


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    config = load_config()
    db = Database(config.db_path)
    await db.connect()

    bot = Bot(config.bot_token)
    admin.setup_admin_filter(config)
    dp = Dispatcher(db=db, config=config)
    dp.include_router(build_router())

    lifecycle = asyncio.create_task(run_lifecycle(bot, db, config))
    try:
        await dp.start_polling(
            bot,
            allowed_updates=["message", "callback_query", "pre_checkout_query", "chat_join_request", "chat_member"],
        )
    finally:
        lifecycle.cancel()
        await db.close()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
