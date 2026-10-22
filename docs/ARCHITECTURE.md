# How the blocks connect

```mermaid
flowchart LR
  subgraph Sources
    AF[API-Football<br/>fixtures, results, live, lineups, injuries, 1X2, O/U, exact-score odds]
    FDU[football-data.co.uk<br/>1X2 + O/U 2.5, free]
    OM[Open-Meteo weather]
    GD[GDELT headlines]
  end
  AF --> P[providers + ResilientClient<br/>retry, breaker, validation]
  FDU --> P
  P -->|history| DC[Dixon-Coles fit]
  P -->|1X2 + O/U, >=2 books| MI[market-implied rates]
  DC --> F[ForecastService]
  MI --> F
  F --> G{gates: history, stale feed,<br/>odds age, fit error}
  G -->|pass| M[score matrix + tail]
  G -->|fail| U[unavailable + reason]
  M --> PK[pick: top score, fair odds,<br/>min odds, EV bar]
  EX[exact-score odds] --> PK
  M --> DB[(SQLite: forecast snapshots,<br/>odds snapshots, watches, notifications, integrity)]
  DB --> MV[line movement]
  MV --> F
  OM --> CX[context: informational only]
  GD --> CX
  AF -->|lineups, injuries| CX
  PK --> TG[Telegram: allowlist, rate limit]
  F --> TG
  CX --> TG
```

**Probability path:** providers → (market-implied if ≥2 bookmakers quote 1X2 and O/U 2.5, else Dixon–Coles) → score matrix →
`/pick`. **Context path** (weather, lineups, injuries, headlines) is shown next to the forecast but does not change
probabilities: its effect is unvalidated, and fresh prices already include public information. Lineups matter indirectly —
once published, bookmaker prices move, and the next market-implied forecast reflects it.

## Failure behaviour per block
| Block | Failure | Result |
|---|---|---|
| Provider HTTP | 5xx/429/timeouts | backoff + jitter, breaker after 5 failures, message without key |
| History | < `MIN_TRAINING_MATCHES` or team < `MIN_TEAM_MATCHES` | forecast unavailable, reason shown |
| Market odds | stale, < 2 bookmakers, poor fit | Dixon–Coles only, flag shown |
| Live | feed older than `LIVE_STALE_SECONDS`, no minute/score | unavailable |
| Exact-score price | missing / below minimum | `no_price` / `no_bet` |
| EV gate | alerts disabled or backtest not passed | at most `candidate` |
| Context sources | any error | listed as unavailable; never invented |
