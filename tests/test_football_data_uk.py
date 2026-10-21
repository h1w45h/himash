from datetime import UTC, datetime

from app.providers.football_data_uk import match_row, parse_fixtures_csv

# SYNTHETIC sample shaped like the site's documented layout; not a real download.
CSV = """Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A,PSH,PSD,PSA,B365>2.5,B365<2.5,PS>2.5,PS<2.5
E0,25/10/2026,15:00,Man United,Tottenham,2.1,3.5,3.4,2.15,3.5,3.5,1.85,2.0,1.9,2.0
E0,bad,15:00,X,Y,1,1,1,,,,,,,
E0,25/10/2026,15:00,,Z,2,3,4,,,,,,,
"""


def test_parse_and_match():
    now = datetime.now(UTC)
    rows = parse_fixtures_csv(CSV, now)
    assert len(rows) == 1 and {o["bookmaker"] for o in rows[0]["odds"]} == {"Bet365", "Pinnacle"}
    k = datetime(2026, 10, 25, 14, tzinfo=UTC)
    assert match_row(rows, "Manchester United", "Tottenham Hotspur", k)  # fuzzy names
    assert match_row(rows, "Arsenal", "Chelsea", k) is None  # no guessing
    assert match_row(rows, "Man United", "Tottenham", datetime(2026, 11, 20, tzinfo=UTC)) is None
