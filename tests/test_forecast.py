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
    assert not f.available and "completed matches" in f.reason


@pytest.mark.asyncio
async def test_stale_live_feed_suppressed():
    svc = ForecastService(Settings(min_training_matches=20), FakeProvider(league()), None, Database(":memory:"))
    live = fx(999, "T1", "T2", 1, 0, 0, "live")
    live = Fixture(**{**live.__dict__, "minute": 30, "observed_at": datetime.now(UTC) - timedelta(minutes=10)})
    f = await svc.forecast(live)
    assert not f.available and "stale" in f.reason
