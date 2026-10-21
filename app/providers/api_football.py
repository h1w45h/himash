from datetime import UTC, datetime
from typing import Any

from app.providers.contracts import Fixture
from app.providers.http import ResilientClient

BASE_URL = "https://v3.football.api-sports.io"
_LIVE = {"1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"}
_FINISHED = {"FT", "AET", "PEN"}
_SCHEDULED = {"TBD", "NS"}
EXACT_SCORE_BET_ID = 10  # API-Football "Exact Score" market
MATCH_WINNER_BET_ID, GOALS_OU_BET_ID = 1, 5


def _status(short: str) -> str:
    if short in _LIVE:
        return "live"
    if short in _FINISHED:
        return "finished"
    if short in _SCHEDULED:
        return "scheduled"
    return "other"


def normalize_fixture(item: dict[str, Any], observed_at: datetime) -> Fixture | None:
    """Validate an external payload; return None for malformed/unusable items."""
    try:
        fx, lg, tm, gl = item["fixture"], item["league"], item["teams"], item["goals"]
        kickoff = datetime.fromisoformat(fx["date"]).astimezone(UTC)
        return Fixture(
            match_id=f"api-football:{int(fx['id'])}", provider="api-football",
            competition_id=str(lg["id"]), competition=str(lg["name"]),
            season=lg.get("season"), kickoff=kickoff,
            status=_status(fx["status"]["short"]), minute=fx["status"].get("elapsed"),
            home_id=str(tm["home"]["id"]), home=str(tm["home"]["name"]),
            away_id=str(tm["away"]["id"]), away=str(tm["away"]["name"]),
            home_goals=gl.get("home"), away_goals=gl.get("away"), observed_at=observed_at,
        )
    except (KeyError, TypeError, ValueError):
        return None


class ApiFootballProvider:
    name = "api-football"

    def __init__(self, api_key: str, client: ResilientClient | None = None) -> None:
        self.client = client or ResilientClient(BASE_URL, {"x-apisports-key": api_key})

    async def _fixtures(self, params: dict[str, Any]) -> list[Fixture]:
        data = await self.client.get_json("/fixtures", params)
        now = datetime.now(UTC)
        items = data.get("response", []) if isinstance(data, dict) else []
        return [f for f in (normalize_fixture(i, now) for i in items) if f]

    async def get_fixtures(self, date_from: str, date_to: str) -> list[Fixture]:
        return await self._fixtures({"from": date_from, "to": date_to})

    async def get_fixture(self, provider_match_id: str) -> Fixture | None:
        r = await self._fixtures({"id": provider_match_id})
        return r[0] if r else None

    async def get_live(self) -> list[Fixture]:
        return await self._fixtures({"live": "all"})

    async def get_competition_results(self, competition_id: str, season: int) -> list[Fixture]:
        return await self._fixtures({"league": competition_id, "season": season, "status": "FT"})

    async def get_match_events(self, provider_match_id: str) -> list[dict[str, Any]]:
        data = await self.client.get_json("/fixtures/events", {"fixture": provider_match_id})
        return data.get("response", []) if isinstance(data, dict) else []

    async def get_prematch_odds(self, provider_match_id: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for bet in (MATCH_WINNER_BET_ID, GOALS_OU_BET_ID):
            data = await self.client.get_json("/odds", {"fixture": provider_match_id, "bet": bet})
            out += parse_prematch_markets(data, datetime.now(UTC))
        return out

    async def get_exact_score_odds(self, provider_match_id: str) -> list[dict[str, Any]]:
        data = await self.client.get_json("/odds", {"fixture": provider_match_id, "bet": EXACT_SCORE_BET_ID})
        return parse_exact_score_odds(data, datetime.now(UTC))


def parse_exact_score_odds(data: Any, observed_at: datetime) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for entry in (data.get("response", []) if isinstance(data, dict) else []):
        for bm in entry.get("bookmakers", []):
            for bet in bm.get("bets", []):
                if bet.get("id") != EXACT_SCORE_BET_ID:
                    continue
                for v in bet.get("values", []):
                    try:
                        odds = float(v["odd"])
                        sel = str(v["value"]).strip().lower().replace("-", ":")
                    except (KeyError, TypeError, ValueError):
                        continue
                    if odds <= 1.0 or odds != odds:
                        continue  # reject malformed prices
                    rows.append({"bookmaker": bm.get("name", "?"), "market": "exact_score",
                                 "selection": sel, "odds": odds, "observed_at": observed_at})
    return rows


def parse_prematch_markets(data: Any, observed_at: datetime) -> list[dict[str, Any]]:
    """Rows for 1X2 (selection home/draw/away) and Over/Under 2.5 (over/under) from /odds."""
    rows: list[dict[str, Any]] = []
    for entry in (data.get("response", []) if isinstance(data, dict) else []):
        for bm in entry.get("bookmakers", []):
            for bet in bm.get("bets", []):
                if bet.get("id") == MATCH_WINNER_BET_ID:
                    market, names = "1x2", {"home": "home", "draw": "draw", "away": "away"}
                elif bet.get("id") == GOALS_OU_BET_ID:
                    market, names = "ou25", {"over 2.5": "over", "under 2.5": "under"}
                else:
                    continue
                for v in bet.get("values", []):
                    try:
                        odds = float(v["odd"])
                        sel = names.get(str(v["value"]).strip().lower())
                    except (KeyError, TypeError, ValueError):
                        continue
                    if sel is None or not odds > 1.0:
                        continue
                    rows.append({"bookmaker": bm.get("name", "?"), "market": market, "selection": sel,
                                 "odds": odds, "observed_at": observed_at})
    return rows
