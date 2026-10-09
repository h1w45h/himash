from datetime import datetime

from bot.config import Plan


def fmt_date(dt: datetime) -> str:
    return dt.strftime("%d.%m.%Y %H:%M UTC")


def plans_text(plans: dict[str, Plan]) -> str:
    lines = [f"• {p.title}: {p.days} дн. за {p.price_stars} ⭐" for p in plans.values()]
    return "Тарифы:\n" + "\n".join(lines)


WELCOME = (
    "Привет! Это бот сигналов.\n\n"
    "После оплаты вы получите ссылку в закрытый канал с сигналами. "
    "Когда подписка закончится, бот уберёт вас из канала; продлить можно в любой момент."
)
NO_SUB = "Активной подписки нет."
HELP = (
    "/start — тарифы и оплата\n"
    "/status — срок подписки\n"
    "/link — новая ссылка в канал (если подписка активна)"
)
ADMIN_HELP = (
    "Команды админа:\n"
    "/grant <user_id> <дней> — выдать или продлить подписку\n"
    "/revoke <user_id> — отключить подписку (кик при следующей проверке)\n"
    "/signal <текст> — отправить сигнал в канал (или ответьте /signal на сообщение, чтобы переслать его)"
)
