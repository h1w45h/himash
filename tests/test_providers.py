import httpx
import pytest

from app.providers.api_football import ApiFootballProvider
from app.providers.http import ProviderError, ResilientClient

FIXTURE = {"fixture": {"id": 1, "date": "2026-01-01T15:00:00+00:00", "status": {"short": "NS", "elapsed": None}},
           "league": {"id": 39, "name": "Premier League", "season": 2025, "country": "England"},
           "teams": {"home": {"id": 1, "name": "A"}, "away": {"id": 2, "name": "B"}},
           "goals": {"home": None, "away": None}}


def client(handler, **kw):
    return ResilientClient("https://x.test", {"x-apisports-key": "SECRET"}, transport=httpx.MockTransport(handler), **kw)


async def test_normalizes_and_drops_malformed():
    def h(req):
        assert req.headers["x-apisports-key"] == "SECRET"
        return httpx.Response(200, json={"response": [FIXTURE, {"bad": 1}]})
    p = ApiFootballProvider("k", client(h))
    fx = await p.get_fixtures("2026-01-01", "2026-01-01")
    assert fx[0].country == "England"
    assert len(fx) == 1 and fx[0].match_id == "api-football:1" and fx[0].status == "scheduled"
    assert fx[0].kickoff.utcoffset().total_seconds() == 0


async def test_retries_then_error_without_leaking_key(monkeypatch):
    calls = []
    def h(req):
        calls.append(1)
        return httpx.Response(503)
    c = client(h, retries=1)
    c._retries = 1
    import app.providers.http as m

    async def nosleep(_):
        return None
    monkeypatch.setattr(m.asyncio, "sleep", nosleep)
    with pytest.raises(ProviderError) as e:
        await c.get_json("/fixtures")
    assert len(calls) == 2 and "SECRET" not in str(e.value)
