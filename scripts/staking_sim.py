"""Monte Carlo: flat 1-unit staking vs capped Fibonacci staking on exact-score bets.

usage: python -I scripts/staking_sim.py
ASSUMPTIONS (not data): hit probability p = 12.6% (the model's typical top-scoreline probability, see README);
'bookmaker margin' scenario uses a -25% EV assumption because no historical exact-score odds were available.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

from app.staking.fibonacci import next_level, stake_units

P = 0.126
N_BETS, BANK, N_SIM, MAX_LEVEL = 300, 200.0, 4000, 6
SCENARIOS = {"fair odds (EV 0%)": 1 / P, "model +5% EV (8.33)": 1.05 / P, "assumed -25% EV (margin)": 0.75 / P}


def run(odds, fib, rng):
    wins = rng.random((N_SIM, N_BETS)) < P
    final, ruined, dd = np.empty(N_SIM), 0, np.empty(N_SIM)
    for s in range(N_SIM):
        bank, level, peak, mdd, dead = BANK, 0, BANK, 0.0, False
        for w in wins[s]:
            stake = stake_units(level, MAX_LEVEL) if fib else 1
            if stake > bank:
                dead = True
                break
            bank += stake * (odds - 1) if w else -stake
            level = next_level(level, bool(w), MAX_LEVEL) if fib else 0
            peak = max(peak, bank)
            mdd = max(mdd, peak - bank)
        final[s], dd[s], ruined = bank, mdd, ruined + dead
    return final.mean(), np.median(final), ruined / N_SIM, np.median(dd)


def main():
    rng = np.random.default_rng(7)
    print(f"p={P:.1%}, {N_BETS} bets, bankroll {BANK:.0f} units, ladder capped at level {MAX_LEVEL} "
          f"({stake_units(MAX_LEVEL, MAX_LEVEL)} units), {N_SIM} simulations")
    print(f"{'scenario':28s} {'plan':9s} {'mean final':>10s} {'median':>8s} {'ruin %':>7s} {'median max drawdown':>20s}")
    for name, odds in SCENARIOS.items():
        for fib in (False, True):
            m, med, ruin, dd = run(odds, fib, rng)
            print(f"{name:28s} {'Fibonacci' if fib else 'flat':9s} {m:10.1f} {med:8.1f} {100 * ruin:7.1f} {dd:20.1f}")


if __name__ == "__main__":
    main()
