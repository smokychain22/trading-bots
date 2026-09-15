# THETA Fill-Model, Multi-Leg Execution, and TCA Research

Closes the P2C directive's sections 11-13, 17. New modules:
`bots/theta/quant/research/execution_tca_research.py` (21 tests) and
`bots/theta/quant/research/strategy_switch_research.py` (7 tests). Shadow
execution-assumption research only -- distinct from and never overriding
THETA's real Production execution safety (Codex-owned, `bots/theta/app/`).

## 1. Fill-model sensitivity (directive section 11)

`estimate_fill_across_models()` returns EVERY requested model's estimate
side by side, per the directive's explicit "recommend sensitivity bands,
not one magic fill model" instruction -- no function anywhere picks a
winning model.

| Model | Bias | Optimism/pessimism | Required inputs | Wide-market handling | Zero-bid handling |
|---|---|---|---|---|---|
| `MID` | OPTIMISTIC | Assumes the trader captures the full spread center -- never achievable for size or urgency | bid, ask | Still computed (mid remains defined), but the caller sees `WIDE_MARKET` via `classify_quote_state` and should discount it accordingly | Undefined for a sell (see below) |
| `BID_SIDE` | PESSIMISTIC | Worst case for a SELLER | bid, ask | Computed as-is | `bid=0` -- a real, meaningful state, reported as `ZERO_BID`, never treated as a data error |
| `ASK_SIDE` | PESSIMISTIC | Worst case for a BUYER | bid, ask | Computed as-is | N/A to a seller |
| `SPREAD_FRACTION` | NEUTRAL_BUT_UNVERIFIED | No inherent direction, but never validated against real fills | bid, ask, caller `spread_fraction` | Concession scales with the (now-wider) spread itself | Returns `MISSING_SPREAD_FRACTION` rather than guessing a fraction |
| `LIQUIDITY_ADJUSTED` | NEUTRAL_BUT_UNVERIFIED | Concession grows with order size relative to caller-supplied available liquidity | bid, ask, order_size, available_liquidity, concession-per-unit-oversize | Same mechanism, compounds with an already-wide spread | Returns `MISSING_LIQUIDITY_INPUTS` if any operand absent |
| `PER_LEG_SLIPPAGE` | NEUTRAL_BUT_UNVERIFIED | A flat caller-supplied slippage estimate per leg | bid, ask, caller `per_leg_slippage` | Same base mechanism | Returns `MISSING_PER_LEG_SLIPPAGE` if absent |

**Zero-bid handling (a real market state, not an error)**: a SELLER facing
`bid=0` gets `price=None, reason=ZERO_BID_NO_SELL_FILL_MODELED` from every
single model -- there is no honest fill price to model when there is
nothing to sell into (real test:
`test_zero_bid_sell_yields_no_modeled_fill_for_any_model`). A BUYER facing
the same zero-bid quote is unaffected (the ask side is still tradeable) --
real test confirms this asymmetry
(`test_zero_bid_buy_side_still_estimates_since_only_selling_is_blocked`).

**Invalid quotes** (`bid > ask`, missing/nonpositive ask) produce
`price=None, reason=INVALID_QUOTE` across every model -- never a
fabricated fallback price from stale or malformed data.

**Wide-market classification** (`classify_quote_state`) is a caller-
justified `wide_market_spread_to_mid_ratio`, never a hardcoded percentage
-- matching this engagement's standing no-invented-threshold discipline.

## 2. Multi-leg fill models (directive section 12)

`evaluate_multi_leg_fill()` implements the two named mechanisms:

- **`SIMULTANEOUS_PACKAGE`**: nets leg fills by caller-supplied sign
  (long/debit = +1, short/credit = -1) into one net price. The directive's
  own framing is upheld: this is the LEAST realistic mode for size or
  wide-market conditions, since real multi-leg fills routinely leg apart.
- **`INDEPENDENT_LEGGING`**: same net-price computation, but additionally
  REQUIRES the caller to supply the actual observed
  `independent_legging_gap_seconds` between the two leg fills -- this
  module never assumes a canonical legging delay. Omitting it yields a net
  price with `legging_exposure_seconds=None` and an explicit
  `MISSING_LEGGING_GAP_SECONDS` reason, so a caller can distinguish "we
  don't know the legging exposure" from "there was none."

**Any missing leg fill** (from an upstream `estimate_fill_across_models`
call that itself returned `None`) propagates to `net_price=None,
reason=AT_LEAST_ONE_LEG_HAS_NO_MODELED_FILL` -- the package is never
priced from a subset of its own legs.

Short-leg-without-hedge and close-before-open sequencing risk (directive's
named concerns) are represented structurally by `INDEPENDENT_LEGGING`'s
own `legging_exposure_seconds` field -- the LONGER that window, the more
of that sequencing risk a research consumer should attribute to the
observation, though this module computes no risk score itself (that
remains a downstream, caller-supplied judgment, consistent with "THETA's
actual execution safety is separate. This is research outcome modeling"
per the directive's own instruction).

## 3. TCA measurements (directive section 13)

`compute_tca()` produces, from caller-supplied already-PIT-safe checkpoint
prices, every field SIGNED FROM THE TRADER'S OWN PERSPECTIVE (positive =
cost):

- `slippage_vs_decision_mid`: decision-time mid vs. actual fill.
- `slippage_vs_arrival_side`: fill vs. the arrival-time NBBO side that
  represents "the expected worst case at arrival" (arrival bid for a
  seller, arrival ask for a buyer).
- `spread_capture_or_concession`: fill vs. arrival mid, positive when the
  fill landed INSIDE the arrival spread (capture) and negative when it
  paid through it (concession).

Every field is `None`, never a fabricated zero, when any required operand
is missing (real test: `test_missing_operand_yields_none`).

**Roll execution cost** (`compute_roll_execution_cost`): sums
`close_leg_cost + open_leg_cost` into `net_roll_execution_cost`, kept
strictly ADDITIVE to -- never blended with -- the old leg's own immutable
realized P&L, upholding the standing ROLL-001 discipline (a roll is
close-old + open-new; the old leg's realized P&L is immutable).

Time-to-fill, partial-fill count, and cancel/replace count are named in
the directive but not modeled as new functions this pass -- they are
straightforward caller-side observations (elapsed time, fill-event counts)
that do not require new arithmetic beyond what a caller's own execution
log already records; flagged honestly as "not requiring new module code"
rather than silently omitted.

## 4. Strategy-switch cost accounting (directive section 17)

`evaluate_strategy_switch()` formalizes `H-Q-04` (already registered in
`hypotheses.json`) into a concrete function. `SwitchCostComponents` charges
every SWITCH candidate for: origin-closing execution cost, new-entry
execution cost, capital-days forgone, and theta/remaining-premium forgone
by closing the origin early -- ALL required, non-optional inputs; any
missing component returns `UNKNOWN`, never a partial cost estimate.

**The directive's own named anti-pattern is structurally prevented, not
just avoided by convention**: `candidate_expected_edge` is documented as
requiring an EX-ANTE estimate (from the candidate's own frontier
evaluation) -- this function has no parameter that could accept a REALIZED
future outcome, so "destination profitable therefore switch was correct"
cannot even be expressed as a call to this function. Real test
`test_realized_pnl_is_never_charged_against_the_switch_decision` confirms
a large realized loss on the origin leg (informational, immutable) never
changes the SWITCH/STAY/WAIT decision.

**Capital-days is deliberately kept out of the dollar-cost sum**
(`test_capital_days_forgone_never_folded_into_the_dollar_cost`) -- it is a
CAPACITY constraint, not a price, matching the multi-objective (never
single-scalar) policy-target design this engagement has standardized on
throughout (see the consolidated receipt's `POLICY_TARGET_DESIGN` entry).

Three outcomes: `SWITCH` (net edge clears a caller-justified
`minimum_net_edge_to_switch`), `WAIT` (net edge is positive but below that
bar -- not yet compelling enough to pay the transition cost), `STAY` (net
edge is negative).
