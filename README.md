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
- Telegram: allowlist (fail-closed), per-user rate limit, all planned commands, watch alerts on goals / 60 min pre-kickoff.
- Integrity: registry with the four evidence labels and review state; only `approved` items are ever shown. There is no
  ingestion job yet — items are added through `app.integrity.registry.add_item` and must be reviewed.

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
