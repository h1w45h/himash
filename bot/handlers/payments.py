import logging

from aiogram import Bot, F, Router
from aiogram.types import CallbackQuery, LabeledPrice, Message, PreCheckoutQuery

from bot import texts
from bot.config import Config
from bot.db import Database
from bot.invites import make_invite_link

router = Router()
log = logging.getLogger(__name__)


@router.callback_query(F.data.startswith("buy:"))
async def buy(callback: CallbackQuery, bot: Bot, config: Config) -> None:
    plan = config.plans.get(callback.data.split(":", 1)[1])
    if plan is None:
        await callback.answer("Тариф не найден", show_alert=True)
        return
    await bot.send_invoice(
        chat_id=callback.from_user.id,
        title=f"Подписка: {plan.title}",
        description=f"Доступ к каналу с сигналами на {plan.days} дн.",
        payload=f"{plan.code}:{callback.from_user.id}",
        currency="XTR",
        prices=[LabeledPrice(label=plan.title, amount=plan.price_stars)],
        provider_token="",
    )
    await callback.answer()


@router.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery, config: Config) -> None:
    code, _, user_id = query.invoice_payload.partition(":")
    plan = config.plans.get(code)
    if (
        plan is None
        or query.currency != "XTR"
        or query.total_amount != plan.price_stars
        or user_id != str(query.from_user.id)
    ):
        await query.answer(ok=False, error_message="Тариф изменился, откройте /start и выберите заново.")
        return
    await query.answer(ok=True)


@router.message(F.successful_payment)
async def successful_payment(message: Message, bot: Bot, db: Database, config: Config) -> None:
    payment = message.successful_payment
    code = payment.invoice_payload.split(":", 1)[0]
    plan = config.plans.get(code)
    user = message.from_user
    await db.upsert_user(user.id, user.username, user.full_name)
    if plan is None:
        # Тариф удалили между счётом и оплатой: деньги пришли, нужен ручной разбор админом.
        log.error("Оплата по неизвестному тарифу %s от %s", code, user.id)
        await message.answer("Оплата получена, но тариф не найден. Напишите администратору.")
        return
    expires = await db.record_payment(
        user.id, plan.code, plan.days, payment.total_amount, payment.telegram_payment_charge_id
    )
    if expires is None:
        log.warning("Повторное уведомление об оплате %s", payment.telegram_payment_charge_id)
        return
    url = await make_invite_link(bot, config.channel_id, user.id)
    await message.answer(
        f"Оплата получена, спасибо! Подписка активна до {texts.fmt_date(expires)}.\n\n"
        f"Ссылка в канал (действует сутки, нажмите «Подать заявку», бот одобрит её сам):\n{url}"
    )
    for admin_id in config.admin_ids:
        try:
            await bot.send_message(
                admin_id, f"💰 Оплата: {user.full_name} (id {user.id}), {plan.title}, {payment.total_amount} ⭐"
            )
        except Exception:
            log.exception("Не удалось уведомить админа %s", admin_id)
