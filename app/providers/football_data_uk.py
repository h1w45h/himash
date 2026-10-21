"""football-data.co.uk free pre-match odds (https://www.football-data.co.uk/fixtures.csv).

No API key. Covers 1X2 and Over/Under 2.5 for upcoming matches of the leagues the site publishes, from several
bookmakers. The CSV carries no observation timestamp, so `observed_at` is our download time (a limitation: the
site updates the file periodically, true price age is unknown). Personal/analytical use per the site's terms;
fetch at most every 30 minutes. The column layout below follows the site's published notes
(https://www.football-data.co.uk/notes.txt) and has NOT been verified against a live download from this sandbox.
"""
import csv
import difflib
import io
import re
import time
import unicodedata
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

URL = "https://www.football-data.co.uk/fixtures.csv"
BOOKMAKERS = {"B365": "Bet365", "BW": "Bwin", "IW": "Interwetten", "PS": "Pinnacle", "WH": "WilliamHill", "VC": "BetVictor"}
CACHE_S = 1800


def _norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\b(fc|cf|afc|sc|ac|as|ss|us|calcio|club|de|1\.)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _f(v: str | None) -> float | None:
    try:
        x = float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return x if x > 1.0 else None


def parse_fixtures_csv(text: str, observed_at: datetime) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(text)):
        try:
            day = datetime.strptime(row["Date"].strip(), "%d/%m/%Y" if len(row["Date"]) > 8 else "%d/%m/%y")
            home, away = row["HomeTeam"].strip(), row["AwayTeam"].strip()
        except (KeyError, ValueError, AttributeError):
            continue
        if not home or not away:
            continue
        odds: list[dict[str, Any]] = []
        for pre, bm in BOOKMAKERS.items():
            for sel, col in (("home", f"{pre}H"), ("draw", f"{pre}D"), ("away", f"{pre}A")):
                if (v := _f(row.get(col))) is not None:
                    odds.append({"bookmaker": bm, "market": "1x2", "selection": sel, "odds": v, "observed_at": observed_at})
            for sel, col in (("over", f"{pre}>2.5"), ("under", f"{pre}<2.5")):
                if (v := _f(row.get(col))) is not None:
                    odds.append({"bookmaker": bm, "market": "ou25", "selection": sel, "odds": v, "observed_at": observed_at})
        out.append({"date": day.date(), "home": home, "away": away, "odds": odds})
    return out


def _sim(a: str, b: str) -> float:
    """String ratio, or 0.9 when every token of the shorter name prefixes a token of the longer one
    ('Man United' ~ 'Manchester United')."""
    na, nb = _norm(a), _norm(b)
    ta, tb = na.split(), nb.split()
    for short, long_ in ((ta, tb), (tb, ta)):
        if short and len(short) <= len(long_) and (len(short) >= 2 or len(short[0]) >= 6) \
                and all(any(t.startswith(s) for t in long_) for s in short):
            return max(0.9, difflib.SequenceMatcher(None, na, nb).ratio())
    return difflib.SequenceMatcher(None, na, nb).ratio()


def match_row(rows: list[dict[str, Any]], home: str, away: str, kickoff: datetime, cutoff: float = 0.85):
    """Both team names must fuzzy-match (>= cutoff) and the date be within 1 day; otherwise None (no guessing)."""
    best, best_score = None, 0.0
    for r in rows:
        if abs((r["date"] - kickoff.date()).days) > 1:
            continue
        sh = _sim(home, r["home"])
        sa = _sim(away, r["away"])
        if min(sh, sa) >= cutoff and sh + sa > best_score:
            best, best_score = r, sh + sa
    return best


class FootballDataUkOdds:
    name = "football-data-uk"

    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._client = httpx.AsyncClient(timeout=15.0, transport=transport, follow_redirects=False)
        self._cache: tuple[float, list[dict[str, Any]]] | None = None

    async def _rows(self) -> list[dict[str, Any]]:
        if self._cache and time.time() - self._cache[0] < CACHE_S:
            return self._cache[1]
        r = await self._client.get(URL)
        r.raise_for_status()
        rows = parse_fixtures_csv(r.text, datetime.now(UTC))
        self._cache = (time.time(), rows)
        return rows

    async def get_prematch_odds_for_fixture(self, fx) -> list[dict[str, Any]]:
        if fx.kickoff - datetime.now(UTC) > timedelta(days=14):
            return []
        m = match_row(await self._rows(), fx.home, fx.away, fx.kickoff)
        return m["odds"] if m else []

    async def get_exact_score_odds(self, provider_match_id: str) -> list[dict[str, Any]]:
        return []  # not offered by this source


class CompositeOdds:
    """Pre-match 1X2/O-U from the primary provider, falling back to football-data.co.uk; exact-score from primary."""

    def __init__(self, primary, fallback: FootballDataUkOdds) -> None:
        self.primary, self.fallback = primary, fallback
        self.name = f"{primary.name}+{fallback.name}"

    async def get_prematch_odds_for_fixture(self, fx) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        try:
            rows = await self.primary.get_prematch_odds(fx.match_id.split(":", 1)[1])
        except Exception:
            pass
        books = {r["bookmaker"] for r in rows if r["market"] == "1x2"}
        if len(books) >= 2:
            return rows
        try:
            return rows + await self.fallback.get_prematch_odds_for_fixture(fx)
        except Exception:
            return rows

    async def get_exact_score_odds(self, provider_match_id: str) -> list[dict[str, Any]]:
        return await self.primary.get_exact_score_odds(provider_match_id)
