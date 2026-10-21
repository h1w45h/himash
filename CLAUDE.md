# CLAUDE.md — FOOTBALL EXACT SCORE INTELLIGENCE

## Mission
You are the engineering agent responsible for implementing this repository into a reliable, testable football analytics system with a Telegram interface. Work incrementally, inspect the existing code before changing it, and keep the project runnable after every phase.

The product analyzes football matches pre-match and live, estimates exact-score probabilities, compares forecasts with bookmaker odds, runs chronological backtests, and tracks source-backed public integrity information.

## Non-negotiable rules
1. Never claim that a match, referee, player, club, or other person is corrupt based only on odds movement, statistical anomalies, rumours, or an open investigation.
2. Keep separate evidence labels:
   - `official_sanction`: published final decision/sanction;
   - `official_investigation`: formally announced investigation, not a finding of guilt;
   - `market_anomaly`: a statistical signal that requires review;
   - `unverified_report`: unconfirmed report, excluded from claims of guilt.
3. No fabricated results, odds, fixtures, source records, provider coverage, or test results. Label fixtures and predictions as unavailable if the source does not supply data.
4. Never hardcode example probabilities into production forecasts. Any demo data must be visibly marked as synthetic.
5. Do not implement automatic bet placement in the initial release.
6. Respect provider licensing, rate limits, terms of use, privacy, and local law. Do not scrape behind authentication or bypass access controls.
7. Do not commit secrets. `.env` is local-only; keep `.env.example` free of real credentials.
8. All persisted timestamps are UTC. Store source observation time separately from ingestion time.
9. All forecasts must be reproducible: store model version, feature/data snapshot reference, generated timestamp, and quality flags.
10. If data is stale, contradictory, or insufficient, suppress recommendations and return a clear reason.

## Start here
1. Read `README.md` and `docs/TECHNICAL_SPEC.md`.
2. Inspect the repository and current git status before edits.
3. Identify incomplete functionality and create/update a phased implementation plan.
4. Run the existing tests and lint/type checks; record the actual outcomes.
5. Implement the smallest complete vertical slice first, with tests.

## Required architecture
Keep modules separated:
- `app/providers/`: provider contracts and individual adapters;
- `app/ingestion/`: polling, retries, deduplication and normalization;
- `app/features/`: team form, attack/defence estimates, lineup and live-state features;
- `app/models/`: Poisson baseline, Dixon–Coles adjustment, calibration and live model;
- `app/odds/`: odds snapshots, market overround/de-vig, fair odds and EV;
- `app/integrity/`: source provenance, evidence labels and review state;
- `app/backtest/`: chronological walk-forward evaluation;
- `app/bot/`: Telegram handlers, allowlist, subscriptions and notifications;
- `app/api/`: health/readiness and internal endpoints;
- `app/storage/`: SQLAlchemy models and migrations;
- `tests/`: unit, integration, model-evaluation and security tests.

Do not put all behavior in one file. Keep provider adapters replaceable and test them with recorded fixtures that contain no credentials.

## Model requirements
- Start with an independent Poisson baseline, then implement a genuine Dixon–Coles low-score correction.
- Fit team attack/defence strengths and league baseline from historical data using regularized likelihood and time decay where justified.
- Ensure adjusted probabilities are finite and non-negative. Document normalization and tail probability when the displayed score matrix is truncated.
- Use strictly chronological training/validation/test windows. Prevent feature leakage from future results, odds, lineups, and corrected data.
- Compare against simple baselines and, when complete odds are available, a documented market-implied baseline.
- Report log loss, Brier score, calibration by probability bucket, top-score hit rate, sample size, and confidence intervals where feasible.
- Live forecasts must model remaining goals conditional on current score/time and validated events; do not reuse a full-match pre-match distribution as though the match had not started.
- If live event delay exceeds configured tolerance or event/score feeds conflict, mark forecast unavailable/stale.

## Odds and EV requirements
For decimal odds `O` and model probability `p`:
- fair odds = `1 / p` when `p > 0`;
- expected value per unit stake before costs = `p * O - 1`.
Treat EV as uncertain and not a guarantee. Use fresh odds, document overround removal, apply data-quality and calibration gates, and avoid a positive-EV alert when the model has not passed out-of-sample evaluation. Do not describe a bet as safe or certain.

## Integrity data requirements
Every integrity record must include source URL, publisher, publication date (if known), retrieval timestamp, subject/competition, case status, neutral summary, source type, and review status. Preserve the distinction between allegation, investigation, and final decision. Add a correction/review mechanism. Do not create a person-level corruption score from weak evidence.

Market anomaly detection should output only neutral states such as `normal`, `review`, or `insufficient_data`. Log the features and thresholds that triggered an alert. Do not infer match fixing from an anomaly alone.

## Telegram requirements
- Use an explicit user/chat allowlist for private deployments.
- Rate-limit commands and provider polling.
- Keep the bot token in environment/secret manager.
- Make notification delivery idempotent and resilient to retries.
- Include match ID, competition, teams, kickoff/status, model version, timestamp, provider freshness, top scoreline probabilities, odds timestamp, EV assumptions, and uncertainty/data-quality status in relevant messages.
- Commands planned in `README.md` must have helpful responses; unsupported commands should say they are not implemented rather than pretend success.

## Security and reliability
- Validate all external payloads and user input.
- Restrict internal endpoints; do not expose PostgreSQL or Redis publicly.
- Add timeouts, retries with exponential backoff and jitter, per-provider quotas, and circuit breakers.
- Use structured logs and redact tokens and personal identifiers.
- Avoid SSRF when retrieving external source URLs; allowlist source domains where practical.
- Use non-root containers and pinned dependency ranges.
- Add health/readiness checks, backup/restore instructions, and migration steps.
- Never log secrets, authorization headers, or full bot tokens.

## Workflow expectations
For each phase:
1. Explain the objective briefly in the PR/commit summary.
2. Implement code and tests together.
3. Run relevant tests, formatting, lint, and type checks.
4. Report exact commands and real outcomes; do not claim checks passed if they were not run.
5. Update docs and `.env.example` when configuration changes.
6. Keep changes small and reviewable.

Suggested phases:
- Phase 0: repository audit, provider/legal constraints, schema design;
- Phase 1: persistence, canonical match IDs, fixture/results ingestion;
- Phase 2: model fitting, Dixon–Coles, probability matrix and calibration;
- Phase 3: odds ingestion, overround, fair odds, EV and backtest;
- Phase 4: Telegram bot, allowlist, subscriptions and notifications;
- Phase 5: live event processing and stale-feed safety;
- Phase 6: integrity sources, evidence provenance and review workflow;
- Phase 7: security, CI, Docker deployment, backups and operations docs.

## Acceptance checklist
- [ ] Fresh checkout can be configured using README instructions.
- [ ] Unit tests cover probability math, Dixon–Coles corrections, odds/EV validation, provider normalization, evidence labels and authorization.
- [ ] Integration tests cover database, Redis, API readiness, Telegram handlers (mocked), retries, duplicate events and stale feeds.
- [ ] Model evaluation is chronological and reproducible.
- [ ] All forecast probabilities are finite, non-negative, and distribution mass/tail treatment is documented.
- [ ] Provider freshness and data-quality gates are visible.
- [ ] No integrity output treats a market anomaly or investigation as proof of wrongdoing.
- [ ] No credentials are present in git-tracked files.
- [ ] Docker services have appropriate health checks and persistent data volumes.
- [ ] README documents provider configuration, tests, deployment, limitations and troubleshooting.

## When blocked
Do not invent provider APIs or assume credentials exist. Implement a typed adapter contract, mock-based tests, and document the exact configuration needed. Ask for a decision only when a real provider choice, paid subscription, or credential is required to proceed.
