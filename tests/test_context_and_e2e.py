from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx

from app.bot.bot import FesiBot
from app.config import Settings
from app.context import lineups, news, weather
from app.context.service import build_context, fmt_context
from app.forecast import ForecastService
from app.storage.db import Database
from tests.test_forecast import FakeOdds, FakeProvider, fx, league

K = datetime(2026, 10, 25, 15, tzinfo=UTC)


def test_weather_summary_and_validation():
    p = {"hourly": {"time": ["2026-10-25T14:00", "2026-10-25T15:00"], "temperature_2m": [10, 11],
                    "precipitation": [0.0, 3.0], "wind_speed_10m": [10, 40]}}
    w = weather.summarize(p, K)
    assert w and w.precip_mm == 3.0 and set(w.flags) == {"heavy rain expected", "strong wind"}
    assert weather.summarize({"hourly": {"time": ["2026-10-25T15:00"]}}, K) is None  # missing fields
    assert weather.summarize(p, K + timedelta(days=2)) is None  # too far from kickoff


async def test_weather_http_flow():
    def h(req):
        if "geocoding" in req.url.host:
            return httpx.Response(200, json={"results": [{"latitude": 1, "longitude": 2}]})
        return httpx.Response(200, json={"hourly": {"time": ["2026-10-25T15:00"], "temperature_2m": [9],
                                                    "precipitation": [0], "wind_speed_10m": [5]}})
    w = await weather.get_weather("X", K, transport=httpx.MockTransport(h))
    assert w and w.temp_c == 9


def test_news_parse_rejects_non_https():
    r = news.parse({"articles": [{"title": "a", "url": "http://x"}, {"title": "b", "url": "https://y/z", "domain": "y"}, {"bad": 1}]})
    assert [h.url for h in r] == ["https://y/z"]


def test_lineup_flags():
    lus = [{"team": {"name": "H"}, "formation": "4-3-3", "startXI": [1] * 11}]
    inj = [{"team": {"name": "A"}, "player": {"name": f"p{i}"}} for i in range(3)]
    n = lineups.summarize(lus, inj, "H", "A")
    f = lineups.flags(n, 30)
    assert any("not published" in x for x in f) and any("3 players" in x for x in f)


class CtxProvider(FakeProvider):
    async def get_fixture(self, mid):
        return fx(int(mid), "T1", "T2", None, None, 1, "scheduled")

    async def get_lineups(self, mid):
        raise RuntimeError("down")

    async def get_injuries(self, mid):
        return []

    async def get_match_events(self, mid):
        return []


async def test_context_fails_soft(monkeypatch):
    async def boom(*a, **k):
        raise httpx.ConnectError("blocked")
    monkeypatch.setattr(weather, "get_weather", boom)
    monkeypatch.setattr(news, "get_headlines", boom)
    f = fx(5, "T1", "T2", None, None, 1, "scheduled")
    f = type(f)(**{**f.__dict__, "venue_city": "Leeds"})
    c = await build_context(f, CtxProvider([]))
    text = fmt_context(f, c)
    assert "unavailable" in text and "does NOT change the probabilities" in text


async def test_every_command_runs_end_to_end(monkeypatch):
    async def boom(*a, **k):
        raise httpx.ConnectError("blocked")
    monkeypatch.setattr(weather, "get_weather", boom)
    monkeypatch.setattr(news, "get_headlines", boom)
    s = Settings(telegram_allowed_user_ids="7", min_training_matches=20)
    db = Database(":memory:")
    prov = CtxProvider(league())
    prov.name = "fake"

    async def get_fixtures(a, b):
        return [fx(1, "T1", "T2", None, None, 1, "scheduled")]
    prov.get_fixtures = get_fixtures
    prov.get_live = AsyncMock(return_value=[])
    svc = ForecastService(s, prov, FakeOdds(), db)
    bot = FesiBot(s, svc, db)
    sent = []

    def upd():
        return SimpleNamespace(effective_user=SimpleNamespace(id=7),
                               message=SimpleNamespace(reply_text=AsyncMock(side_effect=lambda t, **k: sent.append(t))))
    for name, args in [("start", []), ("help", []), ("today", []), ("live", []), ("match", ["1"]), ("score", ["1"]),
                       ("odds", ["1"]), ("pick", ["1"]), ("context", ["1"]), ("integrity", ["1"]), ("watch", ["1"]),
                       ("unwatch", ["1"]), ("report", []), ("settings", []), ("status", []), ("match", ["abc"])]:
        n = len(sent)
        await getattr(bot, name)(upd(), SimpleNamespace(args=args))
        assert len(sent) > n, name
        assert "Internal error" not in sent[-1], (name, sent[-1])
