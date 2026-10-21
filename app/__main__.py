import logging

from app.bot.bot import build_application
from app.config import get_settings
from app.forecast import ForecastService
from app.providers.factory import build_providers
from app.storage.db import Database


class _Redact(logging.Filter):
    def __init__(self, secrets):
        super().__init__()
        self.secrets = [x for x in secrets if x]

    def filter(self, record):
        msg = record.getMessage()
        for sec in self.secrets:
            msg = msg.replace(sec, "***")
        record.msg, record.args = msg, ()
        return True


def main() -> None:
    s = get_settings()
    logging.basicConfig(level=s.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    for h in logging.getLogger().handlers:
        h.addFilter(_Redact([s.telegram_bot_token, s.football_data_api_key, s.odds_api_key]))
    logging.getLogger("httpx").setLevel(logging.WARNING)  # httpx logs full URLs incl. bot token
    db = Database(s.database_path)
    football, odds = build_providers(s)
    app = build_application(s, ForecastService(s, football, odds, db), db)
    app.run_polling()


if __name__ == "__main__":
    main()
