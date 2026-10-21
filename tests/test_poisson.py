import pytest

from app.models.poisson import expected_value, fair_odds, independent_score_probability, poisson_pmf


def test_poisson_zero_rate():
    assert poisson_pmf(0, 0) == 1
    assert poisson_pmf(1, 0) == 0

def test_poisson_invalid_inputs():
    with pytest.raises(ValueError):
        poisson_pmf(-1, 1.2)
    with pytest.raises(ValueError):
        poisson_pmf(1, -0.1)

def test_independent_score_probability():
    p = independent_score_probability(1, 0, 1.2, 0.8)
    assert 0 <= p <= 1

def test_fair_odds():
    assert fair_odds(0.2) == 5
    assert fair_odds(0) is None

def test_ev():
    assert expected_value(0.2, 6) == pytest.approx(0.2)
    assert expected_value(1.0, 1.0) is None
