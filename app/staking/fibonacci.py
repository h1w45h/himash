"""Fibonacci staking ladder (stake size only).

A staking plan changes variance and drawdown, NOT expected value: with negative EV every progression still loses
on average. Therefore the ladder is capped and only suggested for picks with status candidate/bet.
"""
FIB = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]


def stake_units(level: int, max_level: int = 6) -> int:
    return FIB[min(max(level, 0), max_level, len(FIB) - 1)]


def next_level(level: int, won: bool, max_level: int = 6) -> int:
    """Loss: one step up the ladder (capped). Win: two steps down (classic Fibonacci recovery)."""
    return max(level - 2, 0) if won else min(level + 1, max_level)


def losing_streak_prob(p_win: float, n: int) -> float:
    return (1 - p_win) ** n


def outlay_to_level(level: int, max_level: int = 6) -> int:
    """Total units staked after losing every bet from level 0 up to and including `level`."""
    return sum(stake_units(i, max_level) for i in range(level + 1))
