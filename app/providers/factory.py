from app.config import Settings
from app.providers.api_football import ApiFootballProvider
from app.providers.football_data_org import FootballDataOrgProvider


def build_providers(s: Settings):
    """Returns (football_provider, odds_provider|None). Missing keys -> (None, None), never fake data."""
    if not s.football_data_api_key:
        return None, None
    if s.football_data_provider == "api-football":
        p = ApiFootballProvider(s.football_data_api_key)
        odds = p if s.odds_provider == "api-football" else None
        return p, odds
    if s.football_data_provider == "football-data-org":
        return FootballDataOrgProvider(s.football_data_api_key), None
    raise ValueError(f"unknown FOOTBALL_DATA_PROVIDER: {s.football_data_provider}")
