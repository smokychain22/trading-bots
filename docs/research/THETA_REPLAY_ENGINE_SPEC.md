# THETA Replay Engine Specification (R6)

THETA's future backtest/replay engine cannot be a terminal-payoff
calculator — it must replay the full path (entry → hold → manage →
close/roll → assignment → recovery → CC → closure), using only
information available at each simulated timestamp. This spec fixes the
architecture and the point-in-time contract; the implementation
primitives that already exist as real, tested code are named explicitly
so this is not a green-field design.

## 1. What already exists (do not rebuild)

| Primitive | Status | File |
|---|---|---|
| Point-in-time deterministic joins (reject positional joins) | **Implemented, tested** | `bots/theta/quant/research/point_in_time_join.py` (16 tests) |
| Chain resolution/censoring classification | **Implemented, tested** | `bots/theta/quant/research/chain_resolution.py` (7 tests) |
| Target variable (Y = WholeChainPnl) | **Implemented, tested** | `src/theta/ledger-contract.ts::computeWholeChainPnl` (v2, null-honest) |
| Lifecycle state machine (entry→roll→assignment→recovery→CC→closure) | **Implemented, tested** | `src/theta/runtime-state.ts` |
| Management action valuation (HOLD/CLOSE/ROLL/ASSIGN/EXPIRE/REDEPLOY) | **Implemented, tested** | `bots/theta/quant/models/management_action_value.py` |
| Assignment/recovery/CC decision models | **Implemented, tested** | `assignment_model.py`, `recovery_decision.py`, `covered_call_ranker.py` |
| Baseline models, calibration metrics, tail-risk metrics, walk-forward folds | **Implemented, tested** | `bots/theta/quant/research/{baseline_models,calibration_metrics,tail_risk_metrics,walk_forward}.py` (this session) |

The replay engine's job is narrower than it might appear: **drive
THETA's own already-existing decision models forward through simulated
time using historical data**, not reimplement the decision logic itself.
This mirrors LEAN's own architecture (per
`docs/research/THETA_GITHUB_TOP15.md`'s Codex-authored notes): a
scheduler/clock drives event ordering, and strategy logic is invoked
through callbacks at each event — THETA's callbacks already exist as
`management_action_value.py`/`recovery_decision.py`/etc.

## 2. Architecture (informed by the corpus, adapted, never copied)

```
Historical data providers (point-in-time indexed, per point_in_time_join.py)
        |
        v
   Event Clock  --------------------->  Event queue (bar close, expiration,
        |                                assignment notice, corporate action,
        |                                 scheduled rebalance)
        v
  Chain State Machine (runtime-state.ts's ThetaLifecycleState, replayed)
        |
        v
  Decision callbacks (the EXISTING models: theta_q_baseline / management_
  action_value / assignment_model / recovery_decision / covered_call_ranker)
        |
        v
  Fill Simulation (§6 below: directional, side-aware, no midpoint assumption)
        |
        v
  Ledger (ledger-contract.ts's OptionLeg/StockLot/DividendEvent/FeeEvent,
  replayed instead of live-recorded)
        |
        v
  Chain Resolution (chain_resolution.py) -> Episode dataset row
```

- **Event Clock:** per Codex's LEAN review notes, an injected, explicit
  clock (never wall-clock time) that advances only through real
  historical timestamps present in the data — this is what makes the
  replay deterministic and reproducible. Adapted from LEAN's
  time-stepping architecture and `lambdaclass/options_portfolio_
  backtester`'s dedicated `clock.py` (both cited as `ADOPT_METHOD` in
  the gap matrix), never copied as source.
- **Chain State Machine:** THETA already has this
  (`runtime-state.ts::ThetaLifecycleState` + its transition table) —
  the replay engine drives it with historical events instead of live
  ones; no new state machine is invented.
- **Decision callbacks:** the replay engine calls THETA's own existing
  Python models at each decision point, passing only point-in-time-safe
  features (per §3) — it never re-derives entry/management/assignment/
  recovery/CC logic itself.
- **Fill simulation:** see §6.

## 3. Point-in-time feature contract (frozen)

Every feature fed into a decision callback during replay must be
constructible using ONLY observations whose `as_of` is `<= decision
timestamp`, joined via `point_in_time_join.py` (never a positional/index
join). The following timestamps are tracked per observation, per the
directive's explicit list:

- `as_of` — the observation's own real-world timestamp.
- `provider_time` — when the provider says the observation was struck.
- `ingestion_time` — when THETA's own pipeline received it.
- `feature_availability_time` — when a DERIVED feature (e.g. a 20-day
  moving average) becomes computable from `as_of`-safe inputs — this can
  be later than the underlying observations' own `as_of` (e.g. a 20-bar
  MA is only computable once 20 bars exist).
- `label_availability_time` — when the chain's resolution label becomes
  knowable (per `chain_resolution.py`, only once RESOLVED).

**Leakage is testable, not just asserted:** a replay run at simulated
time `T` must produce byte-identical decision inputs whether or not any
data with `as_of > T` exists in the full historical dataset — this is the
same invariant `barsAsOf`/`underlying-history.ts` already tests for
THETA's live path (`tests/underlying-history.test.ts`'s "NO FUTURE
LEAKAGE" tests), generalized to the replay engine.

## 4. Timestamp join safety (implemented)

`point_in_time_join.py` (this session) is the concrete answer to the
corpus review finding that a backtester matched stock and options dates
by list position. Every join in the replay engine — matching a stock bar
to an option quote, matching an option quote to a Greeks snapshot from a
possibly-different source — goes through `join_as_of`, never a raw zip.
16 tests cover missing option/stock days, holidays, duplicate dates,
out-of-order series, and differing sampling frequencies (see the
module's own test file for the exact scenarios).

## 5. Execution simulation (specified, not yet implemented)

Per the directive's explicit instruction: research execution must model
order DIRECTION, never one directionless slippage formula, never a
midpoint-fill assumption.

**Order types to model** (mirrors THETA's own real order-intent states
already in `order-intent-state.ts`, replayed instead of submitted):
`SELL_TO_OPEN`, `BUY_TO_CLOSE`, `SELL_TO_CLOSE`, `BUY_TO_OPEN` (options),
plus stock `BUY`/`SELL`.

**Fill model dimensions** (per `goldspanlabs/optopsy`'s four named
slippage models and `lambdaclass/options_portfolio_backtester`'s
pluggable `FillModel` interface — both `ADOPT_METHOD`, method only, per
license):
- Direction-aware pricing: a SELL_TO_OPEN/SELL_TO_CLOSE fills toward the
  bid side of the spread; a BUY_TO_OPEN/BUY_TO_CLOSE fills toward the
  ask side — never a shared midpoint assumption for both directions
  (this is exactly `lambdaclass`'s `Direction.price_column` pattern,
  already cataloged).
- Liquidity-scaled fill ratio (optopsy's `"liquidity"` model): a thin
  quote (low `bidSize`/`askSize`, already tracked on
  `NormalizedOptionContract`) pushes the assumed fill price further from
  midpoint, toward the full spread.
- No-fill / partial-fill: an order sized larger than the available quote
  size at that timestamp either fails to fill entirely or fills only the
  available portion — never silently assumed fully filled at the quoted
  price.
- Stale-quote rejection: an order timestamped against a quote already
  classified STALE by `data-freshness.ts`'s existing freshness policy
  must fail the fill attempt, never execute against a stale reference
  price.
- Session-state awareness: an order simulated outside real market hours
  (per THETA's own real Alpaca market-calendar wiring,
  `alpaca-provider.ts::fetchMarketCalendar`) fails, mirroring the live
  `SYSTEM_HOLD_MARKET_CLOSED`/`MARKET_HOLIDAY` discipline already built
  for the live path.

**Not yet implemented** — this section is a specification, honestly
distinguished from the point-in-time-join/chain-resolution/baseline
modules above, which ARE implemented. Building the fill simulator itself
is the next concrete engineering task once real historical BBO data
exists to validate against (there is no value in writing a fill
simulator's numeric behavior against synthetic data alone — its whole
purpose is realism against real historical spread/liquidity conditions).

## 6. What this spec explicitly does not do

It does not fit any model. It does not claim a replay has been run
against real data (none exists). It does not invent execution-cost
numbers. Per `THETA_EV_MODEL_SPEC.md`'s own status,
`EV_MODEL_NOT_EMPIRICALLY_READY` remains correct and unaffected by this
document — this spec describes the machinery that WOULD produce
trustworthy episodes once real historical option-chain data is
available, consistent with the standing instruction not to fabricate
that data's existence.
