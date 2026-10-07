# THETA management, execution-price and accounting economics (SHADOW)

Status: source-only research and shadow modules. None of them publishes a plan, changes a Production management action,
changes selection, eligibility or quantity, touches the coordinator submit path, or alters the H no-roll policy. Every
record carries `authority: SHADOW_RESEARCH_NO_EXECUTION` (management) or `NO_SUBMIT_PLAN_ONLY` (price engine).

Provenance labels:
- `OWNER_CURATED_SOURCE_CLAIM`: a rule taken from the owner guide
  (`THETA_PROFITABLE_OPTIONS_TRADER_MASTER_IMPLEMENTATION_GUIDE_2026-10-07.md`). It is not a verbatim transcript.
- `MATH_REPRODUCED`: mathematics implemented here and checked by a test.
- Every numeric threshold in a `*ResearchPolicy` is a **research parameter** for replay grids. None is a Production value.

## Modules (`src/theta/management-economics/`, `src/research/performance-analytics-dashboard.ts`, `src/research/postgres-performance-source.ts`)

Performance analytics is kept in the research namespace because it consumes resolved outcomes for reporting and model
evidence. It has no Production decision authority. Its PostgreSQL source is read-only.

### `black-scholes.ts`
European BS price, delta, gamma, theta/day and vega (MATH_REPRODUCED: textbook value, put-call parity, expiry intrinsic).
American early exercise is not modeled; call sites label it.

### `q-management-economics.ts` (Q)
Evaluated from one snapshot:

- **Actions enumerated:** HOLD / TAKE_PROFIT / RISK_CLOSE / TIME_EXIT / ROLL / ACCEPT_ASSIGNMENT / LET_EXPIRE.
- **Remaining reward** (the current buy-back value) against the **remaining tail** (the extra loss of holding to expiry
  after a −2σ or −3σ move, compared with closing now). This is the economic basis of professional profit-taking
  (guide 8.8, OWNER_CURATED_SOURCE_CLAIM).
- **Other metrics:** a one-week BS mark shock (−2σ over 5 sessions, IV ×1.25); cushion in σ; |delta| (supplied, or BS
  from IV and labelled); premium multiple; capital lock; and hold return per capital-day against the redeployment rate.
- **Thesis status:** VALID / WEAKENING / INVALIDATED. **Trade state:** FAVORABLE / FLAT / ADVERSE.
- **RISK_CLOSE** needs an explicit invalidation **and** a configured risk trigger. A red P&L alone never closes
  (guide 8.9).
- **ROLL** is reported. It is never recommended unless the Q policy permits it, and even then it is a fresh close+open
  decision.
- **Profit policies expressible for replay:** `FIXED_x`, `DTE_EXIT`, `DYNAMIC_REMAINING_REWARD`
  (`minRemainingRewardToTail`), and `DYNAMIC_REDEPLOYMENT_VALUE` (`redeploymentAdvantage`).

### `d-management-economics.ts` (D, whole spread)
- **Pricing:** the close debit is always both legs (short ask − long bid).
- **Metrics:** width, max profit and loss, percent captured, remaining reward against remaining max loss, both-leg
  slippage, spread delta and gamma, exact expiry payoff in all three regions, and a pin-risk flag.
- **Risk close:** on max-loss approach, short-strike threat, liquidity widening, or an optional event. Always the whole
  package.
- **Asymmetric broker legs** → `ASYMMETRIC_EMERGENCY_REVIEW`, which is for sovereign management only. **Unreconciled
  legs** → `RECONCILE_REQUIRED`. There is never an isolated short-leg action.

### `h-early-warning.ts` (H, not a Q clone)
- **Features:** H_GAMMA, dollar gamma per 1%, H_DELTA_ACCELERATION, H_MOVE_SPEED (move in units of the implied move),
  H_SHORT_RV, H_DISTANCE_TO_STRIKE and its velocity, H_EVENT_PROXIMITY (`NOT_APPLICABLE` when no event is scheduled,
  `UNKNOWN` when the calendar is unknown), H_THETA_PER_DAY, and spread.
- **Warnings** escalate WATCH → WARNING → CRITICAL.
- **Actions:** HOLD / TAKE_PROFIT / RISK_CLOSE / TIME_EXIT / EXPIRY / ASSIGNMENT. The action type has **no ROLL member**
  (`NO_ROLL_PRODUCTION_POLICY`).
- **Finding (test):** far-OTM gamma *collapses* toward expiry, while near-the-strike gamma explodes. The short-DTE danger
  is a fast move *into* the strike, which is why move speed and distance velocity are first-class features.

### `c-covered-call-utility.ts` (C, fixes the all-zero default weights in SHADOW)
- **The defect.** Production `DEFAULT_CC_UTILITY_WEIGHTS` (`paper-bootstrap-management-policy.ts:21-23`) are all zero.
  `CCUtility` therefore equals premium income, and `bestCoveredCallCandidate` picks the highest premium, with ties broken
  by contract ID (`covered-call-lattice.ts`).
- **The shadow edge** is computed per contract:

  ```
  edge = premium − E[max(0, S_T − K)] − half spread − event penalty − expected forfeited dividend
  ```

  E[max(0, S_T − K)] uses a lognormal with realized vol (falling back to IV, labelled) and an optional momentum drift.
- **Why that formula:** under a risk-neutral drift with σ = IV, the forfeited upside equals the call's fair value
  (MATH_REPRODUCED), so a covered call earns only from IV > RV, from non-positive drift, or from explicit income
  preference.
- **Holding back:** `HOLD_SHARES_NO_CC` when no call has positive edge (guide 11.3 / 12.3).
- **Share safety:** free shares exclude committed and pending calls. A call-away below the whole-chain basis is never
  selectable, and an unknown event state makes a call unrankable rather than safe.
- **Divergences found in tests:**
  - With strong upside momentum, the legacy logic sells the highest-premium (ATM) call. The shadow returns
    `HOLD_SHARES_NO_CC`.
  - With IV rich against realized vol, both choose the same call, but the shadow ranks by net edge, not premium.
  - When the highest-premium call has an unknown event state, the shadow refuses it and the legacy logic sells it.

### `entry-price-engine.ts` (no-submit)
- **`minimumAcceptableCredit`:** the lowest cent at which the configured hurdles PASS. With no hurdles, it is the lowest
  cent at which reward-to-stress stays within a declared tolerance of the decision value. It is null when even the ask
  fails.
- **SELL_TO_OPEN ladder:** ask → mid → toward the bid, never below the minimum credit.
- **BUY_TO_CLOSE ladder:** bid → mid → toward the ask, never above the maximum debit. A typed `RISK_REDUCTION` urgency
  starts at mid and may reach the ask, and is recorded.
- **Bounds:** ≤ 20 steps, and the deadline is min(decision TTL, quote age, mutation fence).
- **Revalidation:** each step is re-checked against a fresh quote and returns `INVALIDATE_AND_REEVALUATE` on a stale quote
  or an uneconomic price.
- **Tick sizes** ($0.01 < $3 ≤ $0.05) are a labelled assumption.

### `episode-accounting.ts` (A/C whole chain)
- **Input:** ordered lifecycle events, deduplicated by event ID, folded into the existing `WholeChainComponents` and
  computed with `computeWholeChainPnl` (reused, not duplicated).
- **Additions:** immutable per-leg realized P&L (a roll is close old + open new), effective basis, stock P&L, slippage
  (null if any leg is unknown), capital-days (put collateral plus stock held) and return per capital-day.
- **Rejections:** naked calls, double closes and oversized sales are refused. Unknown fees are never zero.

### `performance-analytics/`
- **Grouping:** dashboard rows per strategy, version and regime (unknown regime kept as `UNKNOWN_REGIME`).
- **Metrics:** reuses the R8 receipt for win rate, average win/loss, expectancy, profit factor, drawdown and expected
  shortfall, plus gross/net P&L, ROC, capital-day return, hold, assignment and call-away rates, and slippage.
- **Evidence threshold for PROFITABILITY_STATUS:** NOT_YET_PROVEN until at least **50 resolved broker-confirmed
  episodes**. It then becomes PROVEN_POSITIVE (or PROVEN_NEGATIVE) only if the 95% normal bound of mean net P&L per
  episode excludes zero. Replay and shadow evidence is `RESEARCH_EVIDENCE_ONLY` and can never prove profitability.
- **Read-only Postgres source** (READ ONLY transaction) over the broker ledger. Its SQL has **not been validated against
  a live database** in this branch, because there was no DB access.

## Strategy-intelligence branch reference
The backspread no-loss result on `claude/strategy-intelligence` (credit 1×2 call backspread, loss valley −$900 at the
long strike) must be classified **`LOSS_VALLEY_PRESENT`**, not NO_LOSS. It is ZERO_NET_DEBIT and CREDIT_FINANCED_LONG_VOL
only. This branch does not edit that one.

## What remains
- **Wiring:** none of these modules is called by the Production management cycle yet. The next step is a
  shadow-recording hook (no action authority) in the management scan, plus persistence of the records.
- **Replay:** run the research policies (FIXED_25/50/65/75/80, DTE/time exits, dynamic remaining reward, redeployment)
  over historical paths (the Q replay branch). No values are promoted without walk-forward and OOS evidence.
- **H:** intraday bars and a previous-observation store for live features.
- **C:** a momentum-drift source (regime engine) and an ex-dividend calendar.
- **Price engine:** integrate with the pre-submit handoff behind a disabled flag; certify against the fence in a DB test.
- **Performance SQL:** validate against a test database; add regime labels from the decision receipt.
