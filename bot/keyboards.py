from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from bot.config import Plan


def plans_keyboard(plans: dict[str, Plan]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=f"{p.title} — {p.price_stars} ⭐", callback_data=f"buy:{p.code}")]
            for p in plans.values()
        ]
    )
