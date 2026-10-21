from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol


@dataclass(frozen=True)
class Fixture:
    """Canonical fixture. `match_id` is `<provider>:<provider_id>`; times are UTC."""
    match_id: str
    provider: str
    competition_id: str
    competition: str
    season: int | None
    kickoff: datetime
    status: str  # scheduled | live | finished | other
    minute: int | None
    home_id: str
    home: str
    away_id: str
    away: str
    home_goals: int | None
    away_goals: int | None
    observed_at: datetime  # when the provider-side data was observed (fetch time)


class FootballDataProvider(Protocol):
    name: str

    async def get_fixtures(self, date_from: str, date_to: str) -> list[Fixture]: ...
    async def get_fixture(self, provider_match_id: str) -> Fixture | None: ...
    async def get_live(self) -> list[Fixture]: ...
    async def get_competition_results(self, competition_id: str, season: int) -> list[Fixture]: ...
    async def get_match_events(self, provider_match_id: str) -> list[dict[str, Any]]: ...


class OddsProvider(Protocol):
    name: str

    async def get_exact_score_odds(self, provider_match_id: str) -> list[dict[str, Any]]:
        """Rows: bookmaker, market, selection ('1:0' / 'other'), odds (float), observed_at (datetime)."""
        ...

# Implement adapters only for providers whose terms permit storage, analysis, and redistribution.
