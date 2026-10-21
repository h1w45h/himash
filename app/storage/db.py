"""SQLite persistence (stdlib). All timestamps are stored as UTC ISO-8601 strings."""
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS forecast_snapshot(
  id INTEGER PRIMARY KEY, match_id TEXT NOT NULL, created_at TEXT NOT NULL, model_version TEXT NOT NULL,
  mode TEXT NOT NULL, data_hash TEXT NOT NULL, payload TEXT NOT NULL,
  outcome_home INTEGER, outcome_away INTEGER, resolved_at TEXT);
CREATE TABLE IF NOT EXISTS watch(user_id INTEGER, match_id TEXT, PRIMARY KEY(user_id, match_id));
CREATE TABLE IF NOT EXISTS notification_log(
  user_id INTEGER, match_id TEXT, forecast_version TEXT, alert_type TEXT, sent_at TEXT,
  PRIMARY KEY(user_id, match_id, forecast_version, alert_type));
CREATE TABLE IF NOT EXISTS integrity_item(
  id INTEGER PRIMARY KEY, status TEXT NOT NULL, source_url TEXT NOT NULL, publisher TEXT NOT NULL,
  published TEXT, retrieved_at TEXT NOT NULL, subject TEXT NOT NULL, competition TEXT,
  summary TEXT NOT NULL, source_type TEXT, snippet_hash TEXT, review_state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS backtest_run(id INTEGER PRIMARY KEY, created_at TEXT, competition TEXT, payload TEXT);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


class Database:
    def __init__(self, path: str) -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)

    def save_forecast(self, match_id: str, model_version: str, mode: str, data_hash: str, payload: dict) -> int:
        cur = self.conn.execute(
            "INSERT INTO forecast_snapshot(match_id,created_at,model_version,mode,data_hash,payload) VALUES(?,?,?,?,?,?)",
            (match_id, _now(), model_version, mode, data_hash, json.dumps(payload, default=str)))
        self.conn.commit()
        return int(cur.lastrowid)

    def unresolved_forecasts(self) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM forecast_snapshot WHERE resolved_at IS NULL AND mode='prematch'").fetchall()

    def resolve_forecast(self, fid: int, h: int, a: int) -> None:
        self.conn.execute("UPDATE forecast_snapshot SET outcome_home=?, outcome_away=?, resolved_at=? WHERE id=?",
                          (h, a, _now(), fid))
        self.conn.commit()

    def resolved_forecasts(self) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM forecast_snapshot WHERE resolved_at IS NOT NULL").fetchall()

    def add_watch(self, user_id: int, match_id: str) -> None:
        self.conn.execute("INSERT OR IGNORE INTO watch VALUES(?,?)", (user_id, match_id))
        self.conn.commit()

    def remove_watch(self, user_id: int, match_id: str) -> bool:
        cur = self.conn.execute("DELETE FROM watch WHERE user_id=? AND match_id=?", (user_id, match_id))
        self.conn.commit()
        return cur.rowcount > 0

    def watches(self) -> list[tuple[int, str]]:
        return [(r[0], r[1]) for r in self.conn.execute("SELECT user_id, match_id FROM watch")]

    def claim_notification(self, user_id: int, match_id: str, version: str, alert_type: str) -> bool:
        """Idempotent: True only the first time this key is claimed."""
        cur = self.conn.execute("INSERT OR IGNORE INTO notification_log VALUES(?,?,?,?,?)",
                                (user_id, match_id, version, alert_type, _now()))
        self.conn.commit()
        return cur.rowcount == 1

    def release_notification(self, user_id: int, match_id: str, version: str, alert_type: str) -> None:
        self.conn.execute("DELETE FROM notification_log WHERE user_id=? AND match_id=? AND forecast_version=? AND alert_type=?",
                          (user_id, match_id, version, alert_type))
        self.conn.commit()

    def insert_integrity(self, **f: Any) -> int:
        cols = ",".join(f)
        cur = self.conn.execute(f"INSERT INTO integrity_item({cols}) VALUES({','.join('?' * len(f))})", tuple(f.values()))
        self.conn.commit()
        return int(cur.lastrowid)

    def integrity_items(self) -> list[sqlite3.Row]:
        return self.conn.execute("SELECT * FROM integrity_item").fetchall()

    def save_backtest(self, competition: str, payload: dict) -> None:
        self.conn.execute("INSERT INTO backtest_run(created_at,competition,payload) VALUES(?,?,?)",
                          (_now(), competition, json.dumps(payload)))
        self.conn.commit()
