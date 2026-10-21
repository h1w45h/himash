from app.config import Settings
from app.providers.api_football import ApiFootballProvider
from app.providers.football_data_org import FootballDataOrgProvider
from app.providers.football_data_uk import CompositeOdds, FootballDataUkOdds


def build_providers(s: Settings):
    """Returns (football_provider, odds_provider|None). Missing keys -> (None, None), never fake data."""
    if not s.football_data_api_key:
        return None, None
    if s.football_data_provider == "api-football":
        p = ApiFootballProvider(s.football_data_api_key)
        if s.odds_provider == "api-football":
            return p, p
        if s.odds_provider == "api-football+football-data-uk":
            return p, CompositeOdds(p, FootballDataUkOdds())
        if s.odds_provider == "football-data-uk":
            return p, FootballDataUkOdds()
        return p, None
    if s.football_data_provider == "football-data-org":
        odds = FootballDataUkOdds() if s.odds_provider == "football-data-uk" else None
        return FootballDataOrgProvider(s.football_data_api_key), odds
    raise ValueError(f"unknown FOOTBALL_DATA_PROVIDER: {s.football_data_provider}")
