# R8 Defined-Risk preregistration

Status: research protocol only, frozen BEFORE any Defined-Risk outcome data is examined or tuned against. Registered against `415c64c477f5230181a0a78bfef40e64d1718323` on 2026-09-21. `THETA_DEFINED_RISK` (`canonical-strategy-frontier.ts::definedRiskCandidate`, branch `THETA_DEFINED_RISK`, action `OPEN_DEFINED_RISK`) has `executionEnabled: false` and `promotionStatus: 'UNVALIDATED'` in `strategy-package.ts` as of this SHA, and `strategy-package.ts` additionally requires `status: 'RESEARCH_ONLY'` for this branch specifically -- stricter than every other branch. This document does not change that. No Paper execution authority is requested or implied.

## Hypothesis

`THETA_DEFINED_RISK` (short put + long put, real structural fields already computed: `width = shortPut.strike - longPut.strike`, `netCredit = shortPut.bid - longPut.ask`, `maxProfit = netCredit * multiplier`, `maxLoss = (width - netCredit) * multiplier`) trades a strictly bounded maximum loss for reduced net credit and added leg-count execution cost, relative to a bare `THETA_CONVENTIONAL` CSP on the same underlying/expiry. The question is whether that trade is economically favorable after real, two-leg execution costs and realistic fill behavior -- not whether the defined-risk STRUCTURE is theoretically safer (it is, definitionally, via `maxLoss` being finite and known at entry; that is a structural fact, not a research question).

H1 (favorable): after real two-leg TCA and realistic fill probability, Defined-Risk's bounded max-loss and lower required collateral (`width * multiplier` vs. `strike * multiplier` for a bare CSP) produce superior return-on-risk and capital efficiency despite the lower net credit.

H2 (unfavorable, the honest null): the long-put leg's cost (bid-ask crossing on BOTH legs, doubled commission/regulatory fees, wider effective spread) erodes enough of the credit that Defined-Risk underperforms a bare CSP on an after-cost, per-capital-day basis, and the "bounded risk" benefit is not realized often enough (most cycles close before reaching max loss) to compensate.

No claim is made about which is true.

## Pairing logic

Compared against `THETA_CONVENTIONAL` on the SAME underlying and SAME short-put strike/expiration -- the long-put leg is the only structural difference introduced. This is a stricter pairing than "any CSP vs. any spread on the same underlying": the short leg must be IDENTICAL between the two candidates being compared, isolating the long-put leg's marginal effect. Where no such matched pair exists in a given cycle (e.g. the feasible long-put width available doesn't align with an already-open bare-CSP short strike), that cycle is excluded from the primary paired analysis and reported separately as an unpaired/exploratory observation, never silently merged into the paired sample.

## Eligible population

Cycles where:
- A `THETA_CONVENTIONAL` bare-CSP candidate is structurally feasible on a given short-put contract.
- A `THETA_DEFINED_RISK` candidate is ALSO structurally feasible using that exact same short put as its short leg, with a real, executable long put (`INVALID_SPREAD_WIDTH`, `MISMATCHED_EXPIRATION`, `MISMATCHED_MULTIPLIER`, `MULTI_LEG_PRICE_UNKNOWN`, and `NON_POSITIVE_NET_CREDIT` are all hard blockers already enforced structurally by `definedRiskCandidate` -- this preregistration does not relax any of them).
- AEGIS state does not hard-block either candidate.
- Assignment capacity (for the bare-CSP comparator) and collateral capacity (for the spread) are both known and sufficient.

## Decision features (frozen, not coefficients)

Short-leg PIT quotes/Greeks (shared between both candidates by construction); long-leg PIT quote, strike, and resulting width/net-credit/max-loss/max-profit; combined liquidity (`Math.min` of the two legs' volume/openInterest, per `definedRiskCandidate`'s existing convention -- the binding constraint is the THINNER leg, never averaged); combined spreadPct (SUM of both legs' spreadPct, matching the existing structural field, since a two-leg spread's effective execution cost is additive across legs, not averaged).

## Outcome definition

Primary outcome: whole-chain after-cost EV_net compared paired against the bare-CSP comparator on the identical short leg, reported as: net credit received, max loss realized fraction (how much of the theoretical max loss was actually realized when a loss occurred), return-on-risk (`realized P&L / collateral_required`, where `collateral_required` for Defined-Risk is `width * multiplier`, structurally LOWER than a bare CSP's `strike * multiplier` -- this denominator difference is itself a first-class result to report, not to normalize away), and fill quality/execution cost (both legs' realized slippage vs. quoted mid, summed).

Secondary outcomes: Expected Shortfall of the paired return distribution, max drawdown, capital-days (lower collateral requirement should mechanically improve capital-days if all else is equal -- report this as a distinct, expected, structural effect rather than mixing it into "the model found value"), Profit Factor, AvgWin/AvgLoss.

## Censoring

An open (not yet closed) spread position at dataset cutoff is CENSORED -- report its mark-to-market state separately from realized outcomes, never as a realized win/loss. `THETA_DEFINED_RISK` has no assignment/recovery/covered-call continuation path in its current structural definition (it is a defined-risk premium-selling structure, not a Wheel continuation) -- a censored Defined-Risk episode's outcome is therefore simpler to classify than Hold-Strike's (no multi-stage lifecycle to also resolve), but still not a realized number until closed or expired.

## Cost treatment

BOTH legs' real fees and realized TCA are included (never a fabricated zero for either leg individually -- a chain with unknown fee evidence on either leg stays UNKNOWN as a whole, not "the known leg's cost only"). Regulatory/commission cost is not assumed identical per leg without verification; if the real fee producer charges per-contract rather than per-trade, the two-leg cost is doubled relative to the single-leg comparator and that must be verified against real fee evidence, never assumed.

## Lifecycle treatment

`THETA_DEFINED_RISK` is NOT a Wheel-continuation strategy in its current structural definition -- there is no assignment/recovery/covered-call path in `definedRiskCandidate`. If assignment risk on the short leg is structurally possible (it is, since the short put can still be assigned), this preregistration requires an explicit accounting decision, made HERE, before any outcome data is examined: an assigned Defined-Risk short leg is treated as a SEPARATE, NEW `STOCK_HELD` state exactly as a bare-CSP assignment would be, with the long put's remaining value (if any, at time of assignment) credited as an explicit, separately-reported protective-leg proceeds line item -- never silently merged into the stock cost basis without being named as its own line.

## Split policy

Identical chronological walk-forward discipline as the fixed-vs-adaptive and Hold-Strike protocols: embargo overlapping episodes, untouched final OOS window, protocol frozen before that window is observed.

## Ablations

Feature-family ablation ladder (baseline structural fields → + IV/RV → + term/skew → + dealer positioning → + events) applies only to any conditional model explaining WHEN a Defined-Risk structure outperforms a bare CSP (e.g. "does high IV rank favor the spread"), never to the raw paired structural comparison itself. Every ablation stage is gated on PIT-qualification exactly as in the Hold-Strike preregistration, including the standing call-wall/put-wall quarantine.

## Promotion-evidence structure

Same bar as the other two R8 protocols: positive OOS paired after-cost effect with uncertainty bounds excluding a materially adverse effect, acceptable tail/operational metrics, adequate effective independent N, successful Paper observation. Given `strategy-package.ts`'s stricter `RESEARCH_ONLY` requirement for this specific branch, promotion for `THETA_DEFINED_RISK` additionally requires an explicit, separate owner decision to relax that status -- this preregistration does not request or assume that relaxation. `NO_INCREMENTAL_VALUE`, `INSUFFICIENT_EVIDENCE`, and `FEATURE_QUARANTINED` remain valid, successful outcomes.

## Experiment fingerprint

Cohort filters (including the exact "same short leg" pairing rule above), feature versions, cost assumptions (including the per-leg fee-doubling verification), fill model, effective-N target, confidence method, and OOS window dates must be published as an immutable fingerprint before outcome inspection begins for any specific run. Current status: `PREREGISTERED_DESIGN_ONLY`. No fingerprint has been published; no outcome data has been inspected in producing this document.
