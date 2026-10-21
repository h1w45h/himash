from datetime import UTC, datetime
from typing import Any

from app.providers.contracts import Fixture
from app.providers.http import ResilientClient

BASE_URL = "https://api.football-data.org/v4"
_STATUS = {"SCHEDULED": "scheduled", "TIMED": "scheduled", "IN_PLAY": "live", "PAUSED": "live",
           "FINISHED": "finished"}


def normalize_match(m: dict[str, Any], observed_at: datetime) -> Fixture | None:
    try:
        ft = (m.get("score") or {}).get("fullTime") or {}
        comp = m["competition"]
        return Fixture(
            match_id=f"football-data-org:{int(m['id'])}", provider="football-data-org",
            competition_id=str(comp["code"]), competition=str(comp["name"]),
            season=int(m["season"]["startDate"][:4]) if m.get("season") else None,
            kickoff=datetime.fromisoformat(m["utcDate"].replace("Z", "+00:00")).astimezone(UTC),
            status=_STATUS.get(m["status"], "other"), minute=m.get("minute"),
            home_id=str(m["homeTeam"]["id"]), home=str(m["homeTeam"]["name"]),
            away_id=str(m["awayTeam"]["id"]), away=str(m["awayTeam"]["name"]),
            home_goals=ft.get("home"), away_goals=ft.get("away"), observed_at=observed_at,
        )
    except (KeyError, TypeError, ValueError):
        return None


class FootballDataOrgProvider:
    """Fixtures/results only. Free tier: no odds, no event feed, ~10 req/min."""
    name = "football-data-org"

    def __init__(self, api_key: str, client: ResilientClient | None = None) -> None:
        self.client = client or ResilientClient(BASE_URL, {"X-Auth-Token": api_key})

    async def _matches(self, path: str, params: dict[str, Any]) -> list[Fixture]:
        data = await self.client.get_json(path, params)
        now = datetime.now(UTC)
        items = data.get("matches", []) if isinstance(data, dict) else []
        return [f for f in (normalize_match(i, now) for i in items) if f]

    async def get_fixtures(self, date_from: str, date_to: str) -> list[Fixture]:
        return await self._matches("/matches", {"dateFrom": date_from, "dateTo": date_to})

    async def get_fixture(self, provider_match_id: str) -> Fixture | None:
        data = await self.client.get_json(f"/matches/{int(provider_match_id)}")
        return normalize_match(data, datetime.now(UTC)) if isinstance(data, dict) else None

    async def get_live(self) -> list[Fixture]:
        return await self._matches("/matches", {"status": "LIVE"})

    async def get_competition_results(self, competition_id: str, season: int) -> list[Fixture]:
        return await self._matches(f"/competitions/{competition_id}/matches",
                                   {"season": season, "status": "FINISHED"})

    async def get_match_events(self, provider_match_id: str) -> list[dict[str, Any]]:
        return []  # not offered on the free tier; callers must treat as "no event data"
