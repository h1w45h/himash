from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    log_level: str = "INFO"
    database_path: str = "data/fesi.sqlite3"

    telegram_bot_token: str = ""
    telegram_allowed_user_ids: str = ""

    football_data_provider: str = "api-football"  # api-football | football-data-org
    football_data_api_key: str = ""
    odds_provider: str = "api-football"
    odds_api_key: str = ""  # falls back to football_data_api_key when empty

    integrity_source_refresh_hours: int = 12
    live_poll_seconds: int = 30
    live_stale_seconds: int = 120
    odds_stale_seconds: int = 900
    model_version: str = "dixon-coles-v1"
    max_score_goals: int = 8
    ev_min_threshold: float = 0.05
    min_model_confidence: float = 0.60
    min_training_matches: int = 60
    min_team_matches: int = 5
    time_decay_xi: float = Field(default=0.0018, description="per-day exponential decay")
    ev_alerts_enabled: bool = False  # stays off until a backtest passes the calibration gate
    commands_per_minute: int = 20
    max_tips: int = 10  # forecasts per /tips call (each may cost provider requests)

    @property
    def allowed_user_ids(self) -> set[int]:
        return {int(x) for x in self.telegram_allowed_user_ids.replace(" ", "").split(",") if x}

    @property
    def effective_odds_key(self) -> str:
        return self.odds_api_key or self.football_data_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
