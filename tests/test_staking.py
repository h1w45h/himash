from app.staking.fibonacci import losing_streak_prob, next_level, outlay_to_level, stake_units


def test_ladder_and_cap():
    assert [stake_units(i) for i in range(8)] == [1, 1, 2, 3, 5, 8, 13, 13]
    lvl = 0
    for _ in range(10):
        lvl = next_level(lvl, False)
    assert lvl == 6
    assert next_level(6, True) == 4 and next_level(1, True) == 0


def test_streak_and_outlay():
    assert abs(losing_streak_prob(0.126, 8) - 0.874**8) < 1e-12
    assert outlay_to_level(3) == 7
