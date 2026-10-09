import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Plan:
    code: str
    days: int
    price_stars: int
    title: str


@dataclass(frozen=True)
class Config:
    bot_token: str
    channel_id: int
    admin_ids: frozenset[int]
    plans: dict[str, Plan]
    remind_days_before: int
    check_interval_seconds: int
    db_path: str


def parse_plans(raw: str) -> dict[str, Plan]:
    plans: dict[str, Plan] = {}
    for chunk in raw.split(";"):
        chunk = chunk.strip()
        if not chunk:
            continue
        code, days, price, title = (part.strip() for part in chunk.split(":", 3))
        plan = Plan(code=code, days=int(days), price_stars=int(price), title=title)
        if plan.days <= 0 or plan.price_stars <= 0:
            raise ValueError(f"Неверный тариф: {chunk}")
        plans[code] = plan
    if not plans:
        raise ValueError("PLANS пустой")
    return plans


def parse_admin_ids(raw: str) -> frozenset[int]:
    return frozenset(int(x) for x in raw.replace(" ", "").split(",") if x)


def load_config() -> Config:
    return Config(
        bot_token=os.environ["BOT_TOKEN"],
        channel_id=int(os.environ["CHANNEL_ID"]),
        admin_ids=parse_admin_ids(os.environ.get("ADMIN_IDS", "")),
        plans=parse_plans(os.environ.get("PLANS", "month:30:750:Месяц")),
        remind_days_before=int(os.environ.get("REMIND_DAYS_BEFORE", "3")),
        check_interval_seconds=int(os.environ.get("CHECK_INTERVAL_SECONDS", "600")),
        db_path=os.environ.get("DB_PATH", "data/bot.db"),
    )
