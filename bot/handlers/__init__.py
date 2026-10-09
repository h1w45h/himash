from aiogram import Router

from bot.handlers import admin, channel, payments, user


def build_router() -> Router:
    router = Router()
    router.include_routers(admin.router, payments.router, channel.router, user.router)
    return router
