import pytest

from bot.config import parse_admin_ids, parse_plans


def test_parse_plans():
    plans = parse_plans("week:7:250:Неделя; month:30:750:Месяц")
    assert list(plans) == ["week", "month"]
    assert plans["month"].days == 30 and plans["month"].price_stars == 750


def test_parse_plans_rejects_bad():
    with pytest.raises(ValueError):
        parse_plans("week:0:250:Неделя")
    with pytest.raises(ValueError):
        parse_plans("")


def test_parse_admin_ids():
    assert parse_admin_ids("1, 2,3") == {1, 2, 3}
    assert parse_admin_ids("") == frozenset()
