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


def test_market_implied_recovers_rates():
    from app.models.dixon_coles import score_matrix
    from app.models.market_implied import RHO, implied_rates
    m = score_matrix(1.7, 0.9, RHO, 11)
    i, j = __import__("numpy").indices(m.probs.shape)
    lam, mu, err = implied_rates(m.probs[i > j].sum(), m.probs[i == j].sum(), m.probs[(i + j) > 2].sum())
    assert abs(lam - 1.7) < 0.03 and abs(mu - 0.9) < 0.03 and err < 1e-3


def test_movement_states():
    from app.odds.movement import movement
    assert movement(0.50, 0.56, 6).state == "shortening"
    assert movement(0.50, 0.44, 6).state == "drifting"
    assert movement(0.50, 0.51, 6).state == "stable"
    assert movement(0.50, 0.60, 0.2).state == "insufficient_data"
    assert movement(None, 0.6, 6).state == "insufficient_data"


def test_parse_prematch_markets():
    from app.providers.api_football import parse_prematch_markets
    data = {"response": [{"bookmakers": [{"name": "X", "bets": [
        {"id": 1, "values": [{"value": "Home", "odd": "2.0"}, {"value": "Draw", "odd": "3.4"}, {"value": "Away", "odd": "3.8"}]},
        {"id": 5, "values": [{"value": "Over 2.5", "odd": "1.9"}, {"value": "Under 3.5", "odd": "1.2"}]}]}]}]}
    rows = parse_prematch_markets(data, datetime.now(UTC))
    assert {(r["market"], r["selection"]) for r in rows} == {
        ("1x2", "home"), ("1x2", "draw"), ("1x2", "away"), ("ou25", "over")}


def test_composite_matrix_valid():
    import numpy as np

    from app.models.composite import composite_matrix
    from app.models.dixon_coles import score_matrix
    m = composite_matrix(1.5, 1.1, 8)
    assert np.all(np.isfinite(m.probs)) and np.all(m.probs >= 0)
    base = score_matrix(1.5, 1.1, -0.05, 8)
    assert abs(m.probs.sum() - base.probs.sum()) < 0.02  # mass roughly preserved on the grid
    assert np.abs(m.probs - base.probs).max() < 0.02      # close to the plain model: gain is small by design
