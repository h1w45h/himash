from datetime import UTC, datetime, timedelta

import pytest

from app.odds.anomaly import cross_book_divergence
from app.odds.odds import best_prices, devig_proportional, market_is_complete
from app.providers.api_football import parse_exact_score_odds


def test_devig():
    probs, over = devig_proportional({"a": 2.0, "b": 2.0, "c": 4.0})
    assert sum(probs.values()) == pytest.approx(1.0) and over == pytest.approx(0.25)
    assert devig_proportional({"a": 1.0}) is None


def test_stale_and_malformed_dropped():
    now = datetime.now(UTC)
    rows = [{"selection": "1:0", "odds": 7.0, "observed_at": now - timedelta(hours=2)},
            {"selection": "2:0", "odds": 0.5, "observed_at": now},
            {"selection": "1:1", "odds": 6.0, "observed_at": now}]
    assert set(best_prices(rows, now=now)) == {"1:1"}


def test_market_completeness():
    assert not market_is_complete({"1:0", "0:0"})
    assert market_is_complete({"1:0", "other"})


def test_parse_api_football_odds():
    data = {"response": [{"bookmakers": [{"name": "X", "bets": [{"id": 10, "values": [
        {"value": "1:0", "odd": "7.5"}, {"value": "bad", "odd": "abc"}, {"value": "0:0", "odd": "0.9"}]}]}]}]}
    rows = parse_exact_score_odds(data, datetime.now(UTC))
    assert [(r["selection"], r["odds"]) for r in rows] == [("1:0", 7.5)]


def test_anomaly_states_are_neutral():
    assert cross_book_divergence({"a": 5.0}).state == "insufficient_data"
    assert cross_book_divergence({"a": 5, "b": 5.1, "c": 4.9, "d": 5.0, "e": 5.05, "f": 5.02}).state == "normal"
    assert cross_book_divergence({"a": 5, "b": 5.1, "c": 4.9, "d": 5.0, "e": 5.05, "f": 5.02, "g": 5.0, "h": 5.0, "i": 5.0, "j": 5.0, "k": 20.0}).state == "review"
