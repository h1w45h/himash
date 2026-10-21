# FOOTBALL EXACT SCORE INTELLIGENCE (FESI)

Telegram-first football analytics for pre-match and live exact-score probability estimation.

> Status: architecture/specification + starter scaffold. This is not a production-ready betting service. Real data providers, credentials, model calibration, and operational tests must be configured before deployment.

## Product principles
- Global coverage is best-effort: only analyze competitions for which sufficiently reliable data is available.
- Distinguish official integrity findings, active investigations, market anomalies, and unverified reports.
- Never label a person or match corrupt based solely on an anomaly or allegation.
- Every forecast is timestamped, reproducible, and evaluated against historical outcomes.
- No automated bet placement in the initial release.

## MVP features
1. Fixture ingestion and provider normalization.
2. Team-strength and goal-rate estimation.
3. Dixon–Coles scoreline probability matrix.
4. Pre-match and live recalculation using score, time, cards, substitutions and other available events.
5. Odds normalization, bookmaker margin estimate, fair odds and EV.
6. Public integrity-source registry with provenance and status labels.
7. Telegram commands and notifications.
8. Walk-forward backtesting, calibration reports, tests, Docker deployment and security controls.

## Quick start
1. `cp .env.example .env` and fill in the keys below (`.env` is git-ignored; never commit it).
2. Required keys:
   - `TELEGRAM_BOT_TOKEN` — from @BotFather.
   - `TELEGRAM_ALLOWED_USER_IDS` — your numeric Telegram id(s); with an empty list everyone is denied.
   - `FOOTBALL_DATA_API_KEY` — an [API-Football](https://dashboard.api-football.com) key (fixtures, results, live, exact-score odds)
     or, with `FOOTBALL_DATA_PROVIDER=football-data-org`, a football-data.org token (fixtures/results only, no odds).
3. Run locally: `pip install -e .[dev] && python -m app`, or `docker compose up --build`.
4. Tests/lint: `python -m pytest -q` and `ruff check app tests`.

## What is implemented
- Providers: API-Football and football-data.org adapters (timeouts, retry with backoff+jitter, circuit breaker, payload validation).
- Model: regularized, time-decayed Dixon–Coles fit (scipy), truncated score matrix with explicit tail, live remaining-goals model.
- Odds: stale/malformed rejection, best price, proportional de-vig only for complete markets, fair odds, EV.
- Gates: forecasts are suppressed on insufficient history, stale live feed or provider errors; value alerts stay off
  (`EV_ALERTS_ENABLED=false`) and require a passing walk-forward backtest vs. a baseline.
- Storage: SQLite (`DATABASE_PATH`) — immutable forecast snapshots, watches, idempotent notification log, integrity items.
- `/pick <id>`: most likely exact score, fair odds and the minimum odds for +EV; it says `bet` only when a fresh price clears the bar and value alerts are enabled, otherwise `candidate`/`no bet`.
- Telegram: allowlist (fail-closed), per-user rate limit, all planned commands, watch alerts on goals / 60 min pre-kickoff.
- Integrity: registry with the four evidence labels and review state; only `approved` items are ever shown. There is no
  ingestion job yet — items are added through `app.integrity.registry.add_item` and must be reviewed.

## Market analysis test (real data, run with `python -I scripts/market_eval.py data/Matches.csv`)
Data: free GitHub mirror of football-data.co.uk (`xgabora/Club-Football-Match-Data-2000-2025`, pre-match 1X2 and O/U 2.5
prices). Test = 4,651 matches, E0/SP1/I1/D1/F1, 2023-07 → 2026-09, models trained on earlier data only.

| model | exact-score log loss (lower = better) | top-1 hit rate |
|---|---|---|
| league-average Poisson | 3.042 | 11.7% |
| Dixon–Coles (team form, 3y) | 2.937 | 12.5% |
| blend 50/50 | 2.899 | 13.2% |
| **market-implied (de-vigged 1X2 + O/U 2.5)** | **2.886** | **13.3%** |

So pre-match prices are the strongest input; the bot uses them when ≥2 bookmakers quote 1X2 and O/U 2.5, and falls back to
Dixon–Coles otherwise. Even the best scoreline is hit ~1 time in 8.
Not tested (no data): exact-score EV/ROI (no historical exact-score odds) and line movement (the mirror has no
opening/closing columns). `app/odds/movement.py` tracks movement from the bot's own stored snapshots; its default 8%
threshold is **uncalibrated** — run `scripts/calibrate_movement.py` on football-data.co.uk CSVs (PSH→PSCH) locally to set it.

## Known limitations
- Not production-ready or validated for betting: no live-card/stoppage modelling, no PostgreSQL/Redis, no per-user settings,
  no lineup/xG features, exact-score feeds usually lack an "other" selection (so no de-vig is claimed).
- Free API plans limit seasons and requests/day; history is cached for 6 h per competition.
- Provider response shapes were written from the public API docs and are covered by mocked tests only; they have not been
  run against live keys. Check `/status` and the first `/match` after adding keys.

## Telegram command plan
- `/start` — explain bot and consent/disclaimer
- `/help` — commands and data limitations
- `/today` — today's fixtures with data-quality status
- `/match <id>` — full match analysis
- `/score <id>` — exact-score probability ranking
- `/live` — live matches supported by configured provider
- `/odds <id>` — odds snapshot, fair odds and EV
- `/integrity <id>` — source-backed integrity notes; no unsupported allegations
- `/watch <id>` and `/unwatch <id>` — subscribe to match updates
- `/report` — model performance and recent forecast log
- `/settings` — notification thresholds and timezone
- `/status` — provider health and last update times

## Suggested implementation milestones
- M0: provider/legal review, secrets and data contracts
- M1: fixture/results ingestion, canonical IDs and PostgreSQL schema
- M2: Dixon–Coles training, score matrix and calibration
- M3: odds snapshots, de-vigging, EV and historical backtest
- M4: live event processing and Telegram notifications
- M5: integrity source ingestion and provenance review
- M6: load/security testing, deployment runbook and monitoring

See `docs/TECHNICAL_SPEC.md` for the full specification.

## Operations
- **Backup:** the whole state is one SQLite file in the `fesi_data` volume. Stop the bot, then
  `docker compose run --rm -v $PWD:/backup bot python -c "import sqlite3;s=sqlite3.connect('/data/fesi.sqlite3');d=sqlite3.connect('/backup/fesi.bak');s.backup(d)"`.
  Restore by copying the file back to `/data/fesi.sqlite3` while the bot is stopped. Encrypt backups at rest.
- **Schema changes:** tables are created idempotently at start-up (`CREATE TABLE IF NOT EXISTS`); there is no migration tool yet.
- **Troubleshooting:** `/status` shows provider configuration and last successful call. "Access denied" = your id is not in
  `TELEGRAM_ALLOWED_USER_IDS`. "Forecast unavailable: only N completed matches" = the plan/season returns too little history
  (lower `MIN_TRAINING_MATCHES` only knowingly). HTTP 403/429 from a provider = bad key or quota; the client retries with backoff
  and opens a circuit breaker after 5 consecutive failures.
