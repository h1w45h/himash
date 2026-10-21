"""Find the line-movement ('squeeze') threshold from football-data.co.uk season CSVs (free).

usage: python -I scripts/calibrate_movement.py E0_2223.csv E0_2324.csv ...   (download from
https://www.football-data.co.uk/data.php; that host is NOT reachable from the dev sandbox, run it locally)

Columns used: PSH/PSD/PSA (Pinnacle opening) and PSCH/PSCD/PSCA (closing), FTR. For each relative move of the
favourite's de-vigged probability (open -> close) it reports how often that side actually won vs. the closing
probability. A usable 'squeeze' threshold is the smallest move where the realised frequency deviates from the
closing probability less than from the opening one (i.e. the move carried information). Descriptive only.
"""
import sys

import numpy as np
import pandas as pd


def devig(a):
    inv = 1 / a
    return inv / inv.sum(1, keepdims=True)


def main(paths):
    d = pd.concat([pd.read_csv(p, low_memory=False) for p in paths])
    cols = ["PSH", "PSD", "PSA", "PSCH", "PSCD", "PSCA", "FTR"]
    d = d.dropna(subset=cols)
    po = devig(d[["PSH", "PSD", "PSA"]].to_numpy(float))
    pc = devig(d[["PSCH", "PSCD", "PSCA"]].to_numpy(float))
    res = d.FTR.map({"H": 0, "D": 1, "A": 2}).to_numpy()
    fav = po.argmax(1)
    n = len(d)
    rel = pc[np.arange(n), fav] / po[np.arange(n), fav] - 1
    won = (res == fav).astype(float)
    print(f"matches: {n}")
    print("move bucket      n   open_p  close_p  realised   |err_open|  |err_close|")
    for lo, hi in [(-1, -0.15), (-0.15, -0.08), (-0.08, -0.03), (-0.03, 0.03), (0.03, 0.08), (0.08, 0.15), (0.15, 9)]:
        s = (rel >= lo) & (rel < hi)
        if s.sum() < 30:
            continue
        o, c, w = po[np.arange(n), fav][s].mean(), pc[np.arange(n), fav][s].mean(), won[s].mean()
        print(f"[{lo:+.2f},{hi:+.2f}) {s.sum():6d}  {o:.3f}   {c:.3f}    {w:.3f}     {abs(w - o):.3f}      {abs(w - c):.3f}")


if __name__ == "__main__":
    main(sys.argv[1:])
