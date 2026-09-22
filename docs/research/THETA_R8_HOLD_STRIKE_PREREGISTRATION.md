# R8 Hold-Strike preregistration

Status: research protocol only, frozen BEFORE any Hold-Strike outcome data is examined or tuned against. Registered against `415c64c477f5230181a0a78bfef40e64d1718323` on 2026-09-21. `THETA_HOLD_STRIKE` (`canonical-strategy-frontier.ts::singleLegPutCandidate`, branch `THETA_HOLD_STRIKE`) has `executionEnabled: false` and `promotionStatus: 'UNVALIDATED'` in `strategy-package.ts` as of this SHA. This document does not change that. No Paper execution authority is requested or implied by this preregistration.

## Hypothesis

`THETA_HOLD_STRIKE` is structurally identical at entry to `THETA_CONVENTIONAL` (same `singleLegPutCandidate` shape: one short put, `action: 'OPEN_CSP'`, identical economics fields) -- the entire hypothesized difference is in MANAGEMENT: does deliberately holding a short put toward its strike (rather than Conventional's early-close/roll-driven management) produce superior after-cost whole-chain economics on the SAME eligible candidate set, or does it merely trade early tail avoidance for concentrated assignment/recovery burden with no net improvement?

Two directional sub-hypotheses, both falsifiable and neither assumed true:
- H1 (favorable): Hold-Strike's willingness to accept assignment on a strike it believes is fundamentally acceptable produces higher whole-chain after-cost return per capital-day than Conventional's earlier defensive closes, net of the added stock-holding/recovery capital-days.
- H2 (unfavorable, the honest null): Hold-Strike's reduced optionality to exit early produces worse tail outcomes (larger realized losses on adverse moves) that are not compensated by the retained premium, making it dominated by Conventional on a risk-adjusted basis.

No claim is made about which is true. `INSUFFICIENT_EVIDENCE` remains valid until OOS data says otherwise.

## Pairing logic

Same point-in-time candidate set, account state, broker lifecycle, event state, and executable quote evidence as the R8 fixed-vs-adaptive protocol (`THETA_R8_FIXED_VS_ADAPTIVE_PREREGISTRATION.md`), reused rather than redefined. A cycle is eligible for this comparison only when BOTH `THETA_CONVENTIONAL` and `THETA_HOLD_STRIKE` produce a structurally feasible candidate on the identical option contract (same `optionSymbol`) -- Hold-Strike must never be paired against a DIFFERENT strike/expiration chosen more favorably in hindsight. The paired unit is the FULL WHOLE-CHAIN episode from that shared entry (CSP through assignment/recovery/call-away/close, whichever path each branch's own management logic produces), never a single leg.

## Eligible population

Cycles where:
- `THETA_CONVENTIONAL` and `THETA_HOLD_STRIKE` both structurally qualify (`structurallyFeasible: true`) on the same contract, per `commonEvidence`'s hard blockers.
- AEGIS state for that candidate is not `DEFINED_RISK_ONLY` (which would hard-block the single-leg put entirely).
- Assignment capacity (`assignmentCapacityQty`) is known and positive for both branches at entry.
- Event/corporate-action evidence for the underlying is not UNKNOWN at decision time (per this branch's own entry-eligibility gate; an UNKNOWN-event cycle is excluded from the comparison population entirely, not silently treated as eligible).

## Decision features (frozen, not coefficients)

PIT quotes and Greeks (delta, IV, moneyness, spreadPct) from the shared entry contract; liquidity (volume, open interest); event state; assignment capacity; AEGIS state; `downsideCushion` (from `underlyingReferencePrice`/`breakEven`). Missing hard-safety evidence blocks the candidate for BOTH branches identically (they share one contract). Missing optional evidence (IV, delta, OI, volume per `commonEvidence`'s `unknownEvidence` list) stays UNKNOWN and is reported by cohort, never imputed.

## Outcome definition

Primary outcome: whole-chain after-cost net P&L per capital-day, from CSP open through final chain closure (BTC/expiry/assignment→recovery→CC→call-away/stock-exit), for EACH branch's own management path independently. This is never "the option expires OTM" -- a Hold-Strike episode that gets assigned and later profitably exits its stock leg is a different, and not automatically worse, outcome than a Conventional episode that rolled twice and closed early. Both are scored on the SAME whole-chain accounting discipline (`episode_economics.py`, not reinvented here).

Secondary outcomes: assignment rate, recovery duration (when assigned), stock-leg drawdown during recovery, capital-days consumed, TCA/fill quality, Expected Shortfall of the paired whole-chain return distribution, Profit Factor, AvgWin/AvgLoss.

## Censoring

A whole-chain episode still open (not yet fully closed/called-away) at the dataset cutoff is CENSORED, never scored as a realized outcome and never silently dropped from the population count -- report it as `CENSORED` with its partial economics separately from `REALIZED` episodes, matching this branch's own `severe_drawdown_continuous_target.py` censoring convention (`label_available_at = None` for a censored row).

## Cost treatment

Both branches' after-cost figures include: real fees (never a fabricated zero when fee evidence is UNKNOWN -- the whole chain stays UNKNOWN rather than a false zero, per `computeWholeChainPnl`'s existing UNKNOWN-preservation discipline), realized TCA/slippage from actual fills (never a modeled/hypothetical fill unless explicitly labeled and versioned as a separate fill-model variant), and dividend evidence where a proven-complete producer exists for the relevant ownership interval (otherwise UNKNOWN, never coerced to zero -- this preregistration inherits, does not repair, the standing dividend-ingestion gap noted in prior sessions).

## Lifecycle treatment

The full CSP → (BTC_CLOSE / EXPIRE_OTM / ROLL_DECISION) → ASSIGNED → RECOVERY_WAIT → (SELL_STOCK or CC_PROPOSED → CC_OPEN → ...) → CASH/REDEPLOY lifecycle is scored as ONE unit per branch. A roll's old-leg realized loss/gain is immutable and never absorbed into the new leg's numbers (standing TRD rule, restated here because Hold-Strike's management differs specifically in HOW OFTEN a roll is chosen, which materially changes how many roll-immutability boundaries a given whole chain crosses).

## Split policy

Chronological walk-forward, identical to the fixed-vs-adaptive protocol: embargo overlapping episodes, group complete whole chains within one fold (a chain never splits across train/test), untouched final OOS window, protocol frozen before that window is observed. Model, cohort filters, cost model, and fill-model version are frozen before each OOS window per this document's own fingerprint (see below).

## Ablations

Feature-family ablation ladder applied to any conditional model built to EXPLAIN the paired difference (never to the raw comparison itself, which uses only structural/broker-observed fields): baseline (structural fields only, as listed above) → + IV/RV → + term/skew → + dealer positioning (GEX/flow) → + events. Each stage is included ONLY if its underlying fields are independently PIT-qualified per `docs/research/THETA_CLAUDE_A_D_ACCEPTANCE_2026-09-21.md` and this session's Item D repair (a field failing the single-observation joint-proof test, or under the call-wall/put-wall quarantine, is excluded from every ablation stage until requalified).

## Promotion-evidence structure

Identical bar to the fixed-vs-adaptive protocol's "Promotion" section: positive OOS paired after-cost effect with uncertainty bounds excluding a materially adverse effect, acceptable tail/operational metrics, adequate independent N (effective N, not raw episode count -- overlapping same-underlying chains are clustered, not independent), and successful Paper observation. `NO_INCREMENTAL_VALUE`, `INSUFFICIENT_EVIDENCE`, and `FEATURE_QUARANTINED` are valid, successful research conclusions -- none of them blocks closing this preregistration honestly.

## Experiment fingerprint

Cohort filters, feature versions, cost assumptions, fill model, effective-N target, confidence method, and OOS window dates must be published as an immutable fingerprint (matching this document's own hash lineage) BEFORE outcome inspection begins for any specific run. Current status: `PREREGISTERED_DESIGN_ONLY`. No fingerprint has been published; no outcome data has been inspected in producing this document.
