# THETA closed-market execution receipt

Receipt version: `theta-closed-market-execution-v1`

This receipt records the non-market-dependent closure pass that began from canonical SHA `11a746ee14abb7a52e0ca1dabf445eb1a4c08366`. It does not authorize a broker order, follower execution, or live money.

## Closed without a code change

- No new Production correctness defect was found after tracing the canonical strategy frontier, management plan assembly, broker handoff, coordinator, lifecycle writer, and existing replay tests.
- Event `UNKNOWN` remains distinct from `PRESENT` and `ABSENT_VERIFIED` on the broker-authority path.
- AEGIS and sizing were not changed.
- Champion universe, DTE, capital-day, timing, Optionomics, volatility-acceleration, and Pareto-tie challengers already exist as non-authoritative shadow evidence.
- The existing test suite already covers ambiguous submission, restart reconciliation, partial fills, cancel/replace races, put and covered-call rolls, expiration, assignment, recovery, covered calls, call-away, and whole-chain accounting.

## Implemented

- Added a deterministic closed-market lifecycle scenario library for CSP close, CSP expiry, assignment and stock sale, covered-call expiry, covered-call close, covered-call roll, and call-away. All fixtures remain `SIMULATED`, non-executable, and ineligible for policy learning.
- Added a machine-checkable first-canary acceptance receipt. A filled canary is accepted only after persisted decision and intent evidence, deterministic idempotency, exact broker identity, exact contract/side/quantity, acknowledgement, reconciliation, TCA, lifecycle application, new-risk relock, management availability, and zero follower/live mutations. A clean rejection validates the operational path without fabricating fill economics.
- Added UNKNOWN-safe R8 performance analytics for after-cost whole-chain and managed-episode economics, NAV, drawdown, profit factor, average win/loss, MFE/MAE, capital-days, assignment/recovery, covered-call contribution, call-away, and version-coherent strategy attribution.
- Added explicit R8 defect attribution. A loss alone never becomes a defect or ordinary market variance.
- Added grouped chronological walk-forward planning that keeps an economic chain in one split, supports embargo groups, and reserves an untouched final OOS suffix.
- Added Brier, log-loss, ECE, Platt, and isotonic calibration primitives. Callers must supply the sufficiency threshold. Insufficient or one-class samples do not produce a fitted calibrator.

## Still evidence-blocked

- Real first-canary acceptance remains blocked on a naturally selected open-session Paper order and its broker lifecycle evidence.
- R6 model fit, calibration claims, DSR/PBO conclusions, and promotion remain blocked on sufficient independent point-in-time outcomes.
- R8 realized performance and defect attribution remain blocked on real Paper episodes.
- Follower execution remains locked.
- Live money remains forbidden.

## Invariants

- `MASTER_THETA_PAPER` remains the only runtime trader.
- `FOLLOWER_EXECUTION = LOCKED`.
- `LIVE_MONEY_AUTHORIZED = NO`.
- Research and synthetic evidence cannot authorize broker mutation.
- No Production migration was required by this closure pass.
