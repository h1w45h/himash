# FOOTBALL EXACT SCORE INTELLIGENCE — Technical Specification

## 1. Goal and scope
Build a Telegram-first service that analyzes the maximum feasible number of football leagues worldwide, pre-match and in-play. Coverage is provider-dependent: the product must never imply worldwide completeness when feeds are missing, delayed, or licensed only for selected competitions.

Primary outputs:
- exact-score probability distribution and ranked scorelines;
- estimated fair odds, bookmaker-margin-aware comparison and expected value (EV);
- data quality, model confidence, forecast timestamp and model version;
- live updates based on verified event feed;
- source-backed integrity notes separated by evidentiary status;
- backtesting, calibration, alert history and daily performance reports.

Non-goals for MVP:
- automated bet placement;
- claims of certain wins;
- identifying people as corrupt based on rumours, model output, or odds movement;
- bypassing paywalls, provider rate limits, or licensing restrictions.

## 2. Users and interface
Telegram bot with per-user allowlist, configurable timezone, notification thresholds, and commands:
`/start`, `/help`, `/today`, `/match <id>`, `/score <id>`, `/live`, `/odds <id>`, `/integrity <id>`, `/watch <id>`, `/unwatch <id>`, `/report`, `/settings`, `/status`.

Each forecast message must include:
- competition, teams, kickoff/status, canonical match ID;
- data freshness and sources (provider names, not secret URLs);
- top scorelines with probabilities;
- fair odds and available market odds with timestamp;
- EV after documented margin treatment;
- pre-match or live state, score, minute, cards and events when available;
- confidence/data-quality label;
- disclaimer that exact-score outcomes are uncertain.

## 3. Functional requirements

### FR-01 Fixtures and global coverage
Ingest fixtures/results from multiple licensed providers. Normalize country, competition, season, team and match IDs. Deduplicate matches using provider IDs plus kickoff/team matching. Store source timestamps and ingestion timestamps separately. Mark coverage gaps explicitly.

### FR-02 Historical data
Store results, goals, red cards, lineups when available, xG when licensed, team form and odds snapshots. Preserve source and revision history. Corrections must not silently rewrite old forecast inputs.

### FR-03 Pre-match forecasting
Generate forecasts at configurable horizons (default: 24h, 6h, 60m, 15m before kickoff) when data exists. Recompute after material lineup/odds updates. Store immutable forecast snapshots.

### FR-04 Live forecasting
Consume provider live events. Update scoreline distribution using current score, remaining time, red cards, substitutions, penalties and other events only where validated. Use a time-dependent hazard model or remaining-goals model; do not naïvely reuse a full-match pre-match distribution after kickoff. Display feed delay and suppress alerts when stale.

### FR-05 Exact-score engine
Initial baseline: independent Poisson rates, then Dixon–Coles low-score adjustment. Estimate attack/defence strengths with regularized maximum likelihood, home advantage, time decay and league-specific scoring baselines. Support promotion/relegation priors and hierarchical shrinkage for data-poor teams. Use xG and lineups as optional features only when reliable and available.

Dixon–Coles adjustment:
For score (x,y), use independent Poisson probability multiplied by tau(x,y; lambda_home, lambda_away, rho), with tau adjustments for 0-0, 0-1, 1-0, 1-1. Constrain parameters so adjusted probabilities remain non-negative. Fit rho on training data. Normalize only over the full modeled score space; if displaying a truncated matrix, show residual tail probability.

Do not hardcode illustrative probabilities into production. Persist training window, parameter estimates, feature snapshot and model artifact hash.

### FR-06 Odds and EV
Ingest exact-score odds with bookmaker, market, selection, decimal price, observed_at and provider. Reject stale or malformed prices. Estimate overround from a complete market where possible; de-vig implied probabilities using a documented method (e.g. proportional normalization, with alternatives evaluated). Compare model probability p with executable decimal odds O:
- fair odds = 1/p for p > 0;
- EV per unit stake = p*O - 1, before tax, limits, slippage and account-specific terms.
EV is a model estimate, not a guarantee. Use a configurable minimum EV buffer, uncertainty penalty, liquidity/data-quality gates, and out-of-sample calibration gate. If the complete exact-score market is unavailable, do not claim de-vigged market probabilities.

### FR-07 Integrity intelligence
Ingest only public, legally accessible official decisions, official investigation announcements and reputable public reporting. Every item stores source URL, publisher, publication date, retrieval date, quote/snippet hash, affected entity/competition, case status, confidence in source authenticity, and reviewer state.

Required labels:
A. Official final decision/sanction.
B. Officially announced investigation or proceeding (not a finding of guilt).
C. Market anomaly (statistical alert only).
D. Unverified report (excluded from guilt/risk claims).

Rules:
- A market anomaly is not proof of manipulation.
- An investigation is not a final finding.
- No person-level “corruption score” from rumours or weak proxies.
- Show only substantiated source-backed facts; use neutral language and correction workflow.
- Never use integrity status as a covert prediction shortcut without validated evidence and governance.
- If a concerning pattern appears, recommend review by competent integrity professionals; do not publicly accuse individuals.

Potential anomaly features: sudden odds move, cross-book divergence, abnormal move relative to historical volatility, timing, liquidity proxy if legitimately available, and consistency with team/news data. Outputs are `normal`, `review`, or `insufficient_data`, not `fixed`.

### FR-08 Notifications
User-selectable watches. Deduplicate notifications by `(user_id, match_id, forecast_version, alert_type)`. Respect quiet hours, Telegram rate limits and per-user quotas. Send an update only when probability/odds changes exceed a threshold or a material event occurs.

### FR-09 Reports
Daily report with number of forecasts, resolved outcomes, log loss, Brier score, calibration by probability bucket, exact-score hit rate, ROI/EV diagnostics, closing-line comparison if available, provider freshness and failures. Report realized ROI with sample size and uncertainty; do not imply future returns.

## 4. Model design

### 4.1 Training
- Chronological walk-forward splits only; no random split across time.
- Fit on past data, predict a strictly later period.
- Keep leagues/seasons and data availability flags.
- Use regularization and time decay; monitor cold-start behavior.
- Compare baseline Poisson, Dixon–Coles and market-implied baselines.
- Refit on a schedule and on drift triggers, not after seeing test outcomes.

### 4.2 Evaluation
Primary metrics:
- multiclass log loss for exact scores;
- Brier score over scoreline distribution / derived markets;
- calibration curves and expected calibration error;
- top-1 exact-score hit rate (descriptive only);
- ranked probability score for goal-difference/total markets where applicable;
- EV/ROI with confidence intervals, max drawdown and number of bets;
- closing-line value when comparable timestamps/markets exist.

ROI alone is insufficient. Include all eligible forecasts, including skipped opportunities, and account for odds availability and bookmaker limits where known.

### 4.3 Live model
Separate model or conditional process for remaining goals. Inputs include current score, elapsed/remaining time, red cards, substitutions, match state and pre-match rates. Model stoppage time and extra time separately. Penalty shootouts are a distinct market/state. Suspend forecasts when event feed delay exceeds configured threshold or score conflict is detected.

## 5. Data architecture
Services:
1. `ingestion`: fixtures, results, lineups, events and odds adapters.
2. `normalizer`: canonical IDs, dedupe, validation, source timestamps.
3. `feature_service`: rolling form, attack/defence, lineup and match state.
4. `forecast_service`: model inference and immutable snapshots.
5. `odds_service`: odds snapshots, overround and EV.
6. `integrity_service`: public-source records, evidence status and review workflow.
7. `telegram_worker`: commands, watches and notifications.
8. `backtest`: walk-forward evaluation and reports.
9. `scheduler`: polling, retries, refresh jobs and daily reports.

Suggested stack: Python 3.12+, FastAPI, PostgreSQL, Redis, a task queue/scheduler, NumPy/SciPy, pytest, Ruff, Docker Compose. Add a durable queue when provider/event volume requires it.

## 6. Database entities
- `provider`: provider name, terms review, capabilities, active state.
- `competition`, `season`, `team`, `team_alias`.
- `match`: canonical ID, provider IDs, competition, kickoff UTC, status, venue.
- `match_event`: event type, minute, added time, team/player provider ID, observed_at, source.
- `team_match_stats`: xG and other stats with provider/source and availability.
- `lineup_snapshot`: starting XI, substitutes, status, source timestamp.
- `odds_snapshot`: bookmaker, market, selection, odds, observed_at, provider.
- `forecast_snapshot`: match, created_at, model_version, feature hash, rates, score matrix, quality flags.
- `integrity_item`: category, case status, source URL, dates, summary, evidence provenance, review state.
- `telegram_user`, `watch`, `notification_log`.
- `backtest_run`, `forecast_evaluation`, `provider_health`, `audit_log`.

Use UTC timestamps in storage; localize only for display. Add unique constraints for provider IDs and idempotency keys.

## 7. API contracts (internal)
- `GET /health`: process health.
- `GET /ready`: dependencies/model/provider readiness.
- `GET /matches?from=&to=&competition=`: fixtures and coverage metadata.
- `GET /matches/{id}/forecast`: latest forecast and quality flags.
- `GET /matches/{id}/odds`: current and historical odds snapshots.
- `GET /matches/{id}/integrity`: source-backed notes with evidence labels.
- `POST /jobs/refresh`: authenticated internal refresh trigger.
All endpoints require validation, bounded pagination and rate limits. Internal mutation endpoints must not be public by default.

## 8. Security and privacy
- Secrets in environment for development and secret manager in production; never commit `.env`.
- Rotate bot/API keys and restrict provider credentials by environment.
- Telegram allowlist and admin-only commands; rate-limit per user/chat.
- Do not expose database, Redis or internal API to public internet.
- TLS at reverse proxy; database backups encrypted; least-privilege database account.
- Validate external payloads; defend against SSRF when fetching source URLs; restrict outbound domains where feasible.
- Audit admin actions and provider/config changes.
- Minimize personal data; integrity records must link to public evidence and have correction/removal procedures.
- Pin dependency ranges, scan images/dependencies, use non-root container, health checks and backups.
- Add terms-of-use and responsible-gambling notice; obey local law and data-provider licensing.

## 9. Reliability and observability
- Exponential backoff with jitter, circuit breaker, provider quotas and per-provider concurrency limits.
- Staleness alarms for fixtures, odds and live events.
- Structured logs with correlation IDs; redact tokens and user identifiers.
- Metrics: ingestion lag, provider error rate, missing-field rate, forecast latency, model version, Telegram delivery failures, live feed delay.
- Retry-safe jobs and idempotent notification delivery.
- Graceful degradation: mark unsupported or stale matches unavailable rather than inventing values.

## 10. Test plan
Unit tests:
- Poisson PMF edge cases and probability validity.
- Dixon–Coles tau adjustment and normalization.
- fair odds and EV validation.
- odds margin removal.
- provider payload normalization and duplicate handling.
- integrity status labels and source provenance.
- notification idempotency and Telegram command authorization.

Integration tests:
- PostgreSQL migrations, Redis, provider adapter fixtures, API readiness, Telegram handler mocked updates.
- stale-feed suppression and provider outage recovery.
- event ordering, duplicate events and corrected scores.
- backtest leakage prevention.

Model acceptance:
- no future data in features;
- probability distribution finite, non-negative, sums to approximately 1 including tail handling;
- calibration reported per competition/season and confidence intervals;
- comparison against baseline and market;
- minimum sample-size thresholds before enabling EV alerts.

Security tests:
- secret scan, dependency scan, unauthorized Telegram user, rate limiting, input validation, SSRF defenses, DB not publicly bound.

## 11. Deployment
Development: `docker compose up --build`.
Production: VPS with Docker, reverse proxy/TLS, persistent encrypted backups, monitoring and restricted SSH. Do not expose the API directly; bind to localhost behind proxy. Use separate staging and production secrets. Set resource limits and restart policies. Add migrations as a controlled deployment step.

## 12. Acceptance criteria
- All forecasts have immutable timestamps, model version and data provenance.
- Every displayed scoreline probability is generated by the active model.
- Live mode suppresses forecasts when score/event feed is stale or contradictory.
- EV alerts require fresh odds and configured calibration/data-quality thresholds.
- Integrity notes distinguish final decisions, investigations, anomalies and unverified reports.
- No UI or alert labels a match “fixed” solely from statistical anomalies.
- Walk-forward backtest runs reproducibly from documented data snapshot.
- Unit/integration/security tests pass in CI.
- New provider adapters pass contract tests and licensing review.
- Backup/restore, provider outage and Telegram delivery recovery are documented.

## 13. Delivery phases
M0 — provider/terms inventory and contracts.
M1 — database, ingestion, normalization, fixture commands.
M2 — baseline model, Dixon–Coles and forecast snapshots.
M3 — odds, de-vig, EV, backtesting and calibration.
M4 — LIVE event processing and stale-feed safety.
M5 — integrity public-source registry and review workflow.
M6 — Telegram subscriptions, daily report, security and deployment.
M7 — shadow operation for at least several weeks before considering any live decision support.

## 14. Key limitations
Global coverage cannot be guaranteed from one feed. Historical odds and exact-score markets may be expensive or incomplete. Public records do not reveal every investigation, and confidential integrity monitoring is not generally available to a public bot. Dixon–Coles is a statistical baseline, not a detector of match fixing. No model can reliably identify a manipulated match from score statistics alone.
