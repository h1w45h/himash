from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from app.config import Settings
from app.forecast import ForecastService
from app.providers.contracts import Fixture
from app.storage.db import Database


def fx(i, h, a, hg, ag, days, status="finished", season=2025):
    k = datetime.now(UTC) + timedelta(days=days)
    return Fixture(f"fake:{i}", "fake", "1", "Test League", season, k, status, None, h, h, a, a, hg, ag, datetime.now(UTC))


class FakeProvider:
    name = "fake"

    def __init__(self, results):
        self.results = results

    async def get_competition_results(self, c, s):
        return self.results if s == 2025 else []


def league():
    rng = np.random.default_rng(0)
    teams = [f"T{i}" for i in range(6)]
    out, n = [], 0
    for _ in range(4):
        for h in teams:
            for a in teams:
                if h != a:
                    out.append(fx(n, h, a, int(rng.poisson(1.5)), int(rng.poisson(1.1)), -400 + n))
                    n += 1
    return out


@pytest.mark.asyncio
async def test_prematch_forecast_valid():
    svc = ForecastService(Settings(min_training_matches=20), FakeProvider(league()), None, Database(":memory:"))
    f = await svc.forecast(fx(999, "T1", "T2", None, None, 1, "scheduled"))
    assert f.available and f.snapshot_id
    assert sum(p for *_, p in f.top) <= 1
    assert abs(sum(f.outcome.values()) + f.tail - 1) < 1e-9 or abs(sum(f.outcome.values()) - (1 - f.tail)) < 1e-9


@pytest.mark.asyncio
async def test_insufficient_data_suppressed():
    svc = ForecastService(Settings(min_training_matches=500), FakeProvider(league()), None, Database(":memory:"))
    f = await svc.forecast(fx(999, "T1", "T2", None, None, 1, "scheduled"))
    assert not f.available and "сыгранных матчей" in f.reason


@pytest.mark.asyncio
async def test_stale_live_feed_suppressed():
    svc = ForecastService(Settings(min_training_matches=20), FakeProvider(league()), None, Database(":memory:"))
    live = fx(999, "T1", "T2", 1, 0, 0, "live")
    live = Fixture(**{**live.__dict__, "minute": 30, "observed_at": datetime.now(UTC) - timedelta(minutes=10)})
    f = await svc.forecast(live)
    assert not f.available and "устарели" in f.reason


class FakeOdds:
    name = "fake"

    def __init__(self, over=1.9, under=1.9, stale=False):
        self.rows = []
        t = datetime.now(UTC) - timedelta(hours=5 if stale else 0)
        for bm in ("A", "B"):
            for sel, o in (("home", 2.0), ("draw", 3.4), ("away", 3.9)):
                self.rows.append({"bookmaker": bm, "market": "1x2", "selection": sel, "odds": o, "observed_at": t})
            for sel, o in (("over", over), ("under", under)):
                self.rows.append({"bookmaker": bm, "market": "ou25", "selection": sel, "odds": o, "observed_at": t})

    async def get_prematch_odds(self, mid):
        return self.rows

    async def get_exact_score_odds(self, mid):
        return []


async def test_market_implied_used_and_pick_gates():
    svc = ForecastService(Settings(min_training_matches=20), FakeProvider(league()), FakeOdds(), Database(":memory:"))
    f = await svc.forecast(fx(999, "T1", "T2", None, None, 1, "scheduled"))
    assert f.available and f.source == "market-implied"
    pk = svc.pick(f, {})
    assert pk["status"] == "no_price" and pk["min_odds"] > pk["fair_odds"]
    h, a, p = f.top[0]
    assert svc.pick(f, {f"{h}:{a}": pk["fair_odds"] * 0.9})["status"] == "no_bet"
    # price clears the bar but alerts disabled -> candidate, never an unconditional 'bet'
    assert svc.pick(f, {f"{h}:{a}": pk["min_odds"] * 1.2})["status"] == "candidate"


async def test_stale_market_falls_back_to_dc():
    svc = ForecastService(Settings(min_training_matches=20), FakeProvider(league()), FakeOdds(stale=True), Database(":memory:"))
    f = await svc.forecast(fx(999, "T1", "T2", None, None, 1, "scheduled"))
    assert f.available and f.source == "dixon-coles"
