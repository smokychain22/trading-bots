# THETA Economic Formula Reference (Phase 3, canonical)

Durable reference for every strategy-economics formula audited/fixed in
Phase 3. Source of truth is the code cited under "Source" — if this
document and the code ever disagree, the code is authoritative and this
document is stale and should be corrected, not the other way around.

## Q — cash-secured put (single-leg PUT)

**Source**: `src/theta/canonical-strategy-frontier.ts`, `singleLegPutCandidate()`.
Shared verbatim by THETA_CONVENTIONAL (Q) and THETA_HOLD_STRIKE (H) — same
function, different DTE-window policy (`strategy-package.ts` lattice
config), same payoff formulas.

| Name | Formula | Inputs | Units | Sign | Truth class | Edge cases / UNKNOWN |
|---|---|---|---|---|---|---|
| Entry credit (`premiumPerShare`) | `contract.bid` | provider bid quote | $/share | positive for a real credit | MARKET_OBSERVED | `null` when bid is missing (never defaulted to 0) |
| Collateral | `strike * multiplier` | strike (contractual), multiplier (contractual, never assumed 100) | $ | positive | CONTRACTUAL | strike/multiplier are non-nullable on a normalized contract; always known when the contract itself is known |
| Max profit | `premiumPerShare * multiplier` | as above | $ | positive | CONTRACTUAL | `null` iff premium is `null` |
| **Max loss** (fixed Phase 3) | `(strike - premiumPerShare) * multiplier` | as above | $ | positive magnitude (never a signed PnL) | CONTRACTUAL | `null` iff premium is `null`. Equivalently `collateral - maxProfit` (identity, tested) |
| Break-even | `strike - premiumPerShare` (`contract.breakEven`, computed in `option-contract.ts`) | as above | $/share | — | CONTRACTUAL | tracks premium; a higher credit strictly lowers break-even |
| Capital-day yield | `grossPremium / (collateral * dte)` | grossPremium, collateral, dte | $ per $ per day (a rate) | positive for positive premium | derived from CONTRACTUAL inputs | `null` if premium unknown or `dte <= 0` |
| Expected value (`expectedAfterCostEv`) | not computed | — | — | — | EMPIRICAL_ESTIMATE, `NOT_ESTABLISHED` | always `null`; never delta-substituted (STAT-001) |

**Payoff at expiration** (underlying price `U`): `PnL(U) = (premiumPerShare
- max(strike - U, 0)) * multiplier`. Flat at `+maxProfit` for `U >= strike`;
linearly worse below strike; bounded at `-maxLoss` when `U = 0`. Proven by
property test (`tests/phase3-payoff-curve.test.ts`).

## D — defined-risk two-leg (bull put credit spread: short PUT + long PUT, same expiration)

**Source**: `src/theta/canonical-strategy-frontier.ts`, `definedRiskCandidate()`.
Research-only (`RESEARCH_ONLY` status), never Paper-executable, per
existing governance — not changed by Phase 3.

| Name | Formula | Inputs | Units | Sign | Truth class | Edge cases |
|---|---|---|---|---|---|---|
| Width | `shortStrike - longStrike` | both legs' strikes | $ | positive (else `INVALID_SPREAD_WIDTH` hard blocker) | CONTRACTUAL | `<= 0` fails closed, never silently flipped |
| Net credit | `shortPut.bid - longPut.ask` (conservative-side pricing) | both legs' quotes | $/share | positive expected (else `NON_POSITIVE_NET_CREDIT`) | MARKET_OBSERVED | `null` iff either quote missing (`MULTI_LEG_PRICE_UNKNOWN`) |
| Max profit | `netCredit * multiplier` | as above | $ | positive | CONTRACTUAL | `null` iff netCredit `null` |
| Max loss | `(width - netCredit) * multiplier` | as above | $ | positive magnitude | CONTRACTUAL | `null` iff netCredit `null` |
| Break-even | `shortStrike - netCredit` | as above | $/share | — | CONTRACTUAL | tracks netCredit |
| Capital (`collateral`) | `= maxLoss` (defined-risk capital is bounded by the package's own max loss, never undefined-risk collateral) | maxLoss | $ | positive | CONTRACTUAL | identical to maxLoss by definition, tested |

Invalid-package hard blockers (all present, verified by source read):
`INVALID_SPREAD_WIDTH` (width <= 0), `MISMATCHED_EXPIRATION`,
`MISMATCHED_MULTIPLIER`, `MULTI_LEG_PRICE_UNKNOWN` (either leg's price
missing), `NON_POSITIVE_NET_CREDIT`.

**Payoff at expiration**: `PnL(U) = (netCredit - max(shortStrike-U,0) +
max(longStrike-U,0)) * multiplier`. Flat at `+maxProfit` above short
strike, linear transition between strikes, flat at `-maxLoss` at/below long
strike. Proven by property test.

## Cost model (Python baseline, `theta_q_baseline.py:CostAssumptions`)

Every field required explicitly — `commission_per_contract`,
`fees_per_contract`, `est_slippage_per_contract` (all $/contract, same
units, no mixed bps/fraction), `cost_model_version` (a required string).
No defaults anywhere in this dataclass. `cost_per_contract` (their sum) is
computed but **not yet netted into `max_profit`/`maxLoss`** — both remain
GROSS figures by this baseline's own explicit design. `ev_net` is always
`None` with a real, versioned unknown-reason string; never fabricated.

## What is genuinely NOT established (correct, not a gap)

- `expectedAfterCostEv` / `ev_net` — EMPIRICAL_ESTIMATE, `NOT_ESTABLISHED`,
  by design (no calibrated entry-outcome model exists yet — TRD section 17
  is future work).
- Assignment probability, tail/ES estimate, expected drawdown — no field
  exists; not fabricated as a placeholder number.
- Recovery burden — deliberately not modeled at Phase 3 (owned by later
  management phases); entry economics expose the raw inputs (`collateral`,
  `strike`) a later phase needs, never a fabricated recovery probability.

## Versioning

No structural (shape) change was made to `CanonicalFrontierEconomics`,
`CandidateEconomics` (Python), or any hashed canonical-frontier contract
version this pass — only a previously-hardcoded-null field
(`maxLoss`) now computes a real value under the exact same type
(`number | null`). Old historical rows/fixtures that never populated
`maxLoss` remain readable exactly as before (the field was always
optional/nullable; this is an additive correctness fix, not a schema
change) — no backward-compatibility break.
