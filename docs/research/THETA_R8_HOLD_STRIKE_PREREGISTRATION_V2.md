# R8 Hold-Strike preregistration v2

Status: research protocol only, frozen BEFORE any Hold-Strike outcome data is examined or tuned against. Supersedes `THETA_R8_HOLD_STRIKE_PREREGISTRATION.md` (v1) for empirical purposes, per `THETA_R8_HOLD_STRIKE_PREREGISTRATION_ERRATUM.md`'s finding that v1's "same strike/expiration" pairing is structurally unsatisfiable (`THETA_HOLD_STRIKE`'s real DTE lattice, 2-5 days, does not overlap at all with `THETA_CONVENTIONAL`'s, 25-60 days -- `strategy-package.ts`, verified this session). **Neither v1 nor the erratum is edited or deleted; both remain on record.** No Hold-Strike outcome data has been examined at any point before this v2 document, confirmed in the erratum. Registered against canonical main `bf6d80ec71315cb822db87d2f53ecda949e18d25` on 2026-09-22.

**Correction (2026-09-22, before any outcome inspection):** the original v2 text stated several DTE-driven consequences (lower average capital committed per calendar day, a higher realized assignment rate, more actual assignment events) as though they were themselves structural facts, flowing automatically from the DTE difference alone. They are not -- they depend on strike selection, redeployment cadence, real market movement, and management policy behavior, none of which is fixed by the DTE lattice alone. This correction rewrites those claims as empirical hypotheses (see "Secondary hypotheses" below) and states explicitly, in "What v2 changes," exactly what IS structurally guaranteed by the DTE difference alone versus what remains an open empirical question. No Hold-Strike outcome data was examined to make this correction -- it is a pure logical/causal-claim correction, made before the first run, and the document version below is bumped accordingly.

## What v1 got right, kept unchanged in v2

The candidate SHAPE claim (`singleLegPutCandidate`, one short put, `action: 'OPEN_CSP'`, identical economics fields) is accurate and unchanged. The outcome definition (whole-chain after-cost, both branches' own management path independently), censoring convention (`label_available_at = None` for open/unresolved chains), cost treatment (real fees/TCA, both directions), lifecycle treatment (roll-immutability), and split policy (chronological walk-forward, embargoed) all remain valid and are inherited from v1 without change.

## What v2 changes: the pairing structure

v1 required an identical contract (same strike, same expiration) between the two branches -- impossible given the disjoint DTE lattices. v2 abandons "same contract" pairing entirely and instead pairs on **decision context**, matching the directive's own suggested structure:

- **Same underlying, same decision time** -- both branches' evaluation runs against the identical point-in-time universe/ownership/regime snapshot (the SAME `FusionSnapshot`, not merely the same calendar day).
- **Same ownership eligibility** -- both branches must be structurally eligible to trade the underlying at that decision time (`assessUniverseEventEvidence`/AEGIS state identical for both, since they share the decision context).
- **Same market/regime state** -- both branches see the identical volatility/trend/event-proximity regime classification at decision time.
- **Strategy-specific valid DTE lattice** -- Conventional evaluates its real 25-60 DTE lattice; Hold-Strike evaluates its real 2-5 DTE lattice. Neither is forced onto the other's window. This is the core structural change from v1.
- **Common whole-chain outcome horizon** -- both branches' outcomes are measured over the SAME calendar window from decision time (e.g. 90 calendar days), regardless of how many discrete option cycles each branch completes within it. This is deliberate: the comparison question becomes "which policy produces better economics over a fixed calendar period," not "which policy produces better economics per single option cycle" -- the latter comparison is exactly what v1 could never construct honestly, and inventing an artificial single-cycle equivalence would just reintroduce the same flaw under a different name.
- **Capital-normalized economics, as the PRIMARY outcome variable -- a methodological choice, not a predicted structural result.** The primary outcome is return-per-capital-day over the common horizon, not raw P&L, so that a policy which simply commits more capital for longer is not automatically favored for a reason unrelated to the strategy difference being studied. This says nothing yet about which policy will actually turn out more capital-efficient -- see "What is structurally true vs. what is an empirical hypothesis" immediately below.

### What is structurally true vs. what is an empirical hypothesis

Structurally TRUE, guaranteed by the DTE lattice configuration alone, requiring no outcome data to state:
- Hold-Strike's individual option-cycle contractual exposure window (2-5 days) is shorter than Conventional's (25-60 days).
- Over a fixed common calendar horizon, Hold-Strike has structurally MORE potential decision/redeployment opportunities than Conventional (more cycles COULD fit in the same window) -- this is a fact about the number of opportunities, not about capital committed, assignment outcomes, or realized cadence.

Explicitly NOT structurally true -- each of these depends on strike selection, real market movement, redeployment behavior, and management policy choices that are NOT fixed by the DTE lattice, and must be treated as empirical hypotheses, tested, never assumed:
- That Hold-Strike's AVERAGE capital committed per calendar day is lower than Conventional's (a policy could choose to redeploy immediately and continuously, offsetting the capital-efficiency intuition entirely).
- That Hold-Strike's REALIZED assignment rate is higher than Conventional's (this depends on how close to the money each policy's strikes are chosen, not merely on DTE).
- That Hold-Strike will actually COMPLETE more cycles within a fixed horizon than Conventional (redeployment cadence, not just contractual DTE, determines realized cycle count -- a policy could sit idle between cycles).

## Primary hypothesis

Over a fixed common calendar horizon, on the same underlying/decision-context pairs, does `THETA_HOLD_STRIKE`'s much-shorter-DTE, hold-toward-strike policy produce superior capital-normalized whole-chain after-cost economics (return per capital-day) compared to `THETA_CONVENTIONAL`'s longer-DTE, earlier-defensive-management policy -- net of Hold-Strike's structurally higher cycle-turnover transaction costs (more, smaller trades over the same horizon means more individual execution-cost events)?

H1 (favorable): Hold-Strike's REALIZED capital efficiency (empirically lower average collateral tied up per calendar day, IF that turns out to be true) and premium-collection frequency outweigh its aggregate transaction-cost burden and REALIZED assignment frequency. Every one of these is an empirical claim, none is assumed by the DTE lattice alone (see "What is structurally true vs. what is an empirical hypothesis" above).
H2 (unfavorable, the honest null): Hold-Strike's realized trade frequency's transaction-cost and assignment/recovery burden erode any realized capital-efficiency advantage (if one even exists), making it dominated by Conventional on a risk-adjusted, capital-normalized basis.

No claim is made about which is true.

## Secondary hypotheses

- H2a: Hold-Strike's REALIZED assignment rate is materially higher than Conventional's per calendar day of exposure. This is an EMPIRICAL hypothesis, not a structural consequence of the DTE difference alone -- realized assignment rate depends on strike selection relative to the underlying, not merely on DTE.
- H2b: Hold-Strike's aggregate execution cost (sum of all cycle transaction costs within the common horizon) exceeds Conventional's by more than its capital-efficiency advantage compensates for -- this presupposes H1's capital-efficiency claim is itself true, which is not assumed.
- H2c (new): Hold-Strike's REALIZED cycle count within a fixed common horizon is materially higher than Conventional's. This is an empirical claim about redeployment cadence, distinct from the structural fact that more cycles COULD potentially fit in the window.

## Population

Decision-time snapshots where BOTH branches are structurally feasible (per `strategy-timing-router.ts`'s CASH_AVAILABLE eligibility) on the same underlying, with complete PIT evidence for both (no UNKNOWN hard-safety gate for either). A snapshot where only one branch is feasible is excluded from the PRIMARY paired analysis and reported separately as an unpaired observation.

## Exclusions

Snapshots with incomplete event/corporate-action evidence (per the standing fail-closed universe-policy gate); snapshots where AEGIS state differs between the two branches' evaluation somehow (should not happen given shared decision context, but verified, not assumed). A chain still open at the horizon boundary is NO LONGER excluded outright -- see "Horizon-end terminal valuation policy" below, which replaces the prior blanket exclusion.

## Horizon-end terminal valuation policy (corrected -- prevents survivorship/selection bias)

The original v2 text excluded any chain still open at the horizon boundary. This creates a serious selection bias: it would systematically drop exactly the chains still in a difficult recovery (a losing or long-recovery position), inflating both policies' apparent performance by omitting their worst-case tails. This is corrected as follows, PRE-REGISTERED before any outcome inspection:

The study uses **(B) horizon-end analytical mark-to-market valuation with explicit provenance**: any position (option or assigned stock) still open at exactly the horizon boundary is valued at its analytical mark (the same `analyticalOptionMarkDollars`/stock-mark convention already established elsewhere in this codebase) AS OF the horizon boundary, and that mark-to-market value is ADDED to the realized P&L accumulated up to that point to form the horizon-level outcome for that branch/pair. This combined figure is tagged with an explicit `terminalValuationProvenance` field: `REALIZED` for a chain that fully closed before the horizon boundary, `ANALYTICAL_MTM_AT_HORIZON` for one that did not. The two are NEVER silently merged into one undifferentiated "outcome" number without this tag traveling with it -- any consumer of horizon-level outcomes must be able to separate REALIZED-only results from results that include an unresolved-position mark.

(A) real executable MTM was not chosen because no genuine executable quote exists for the express purpose of a research valuation at an arbitrary future date (this would require re-fetching a live quote at the exact horizon boundary for every open chain, which is a real-data-collection requirement out of scope for the protocol itself, not a methodological objection). (C) formal survival/censoring statistical methodology remains a valid FUTURE refinement once enough resolved-vs-unresolved chain volume exists to make a survival model worthwhile, but is not chosen as the PRIMARY method now, since (B) already directly addresses the selection-bias concern without requiring a more complex model family, consistent with this engagement's simple-first modeling principle.

### Terminal valuation PIT contract (finished 2026-09-22, before any outcome inspection)

`ANALYTICAL_MTM_AT_HORIZON` is only PIT-safe if every input the mark is built from was observed AT OR BEFORE the horizon boundary it is valuing. This is enforced, not merely asserted, by `src/research/hold-strike-terminal-valuation-pit-contract.ts`: every terminal valuation record carries `terminalValuationTimestamp`, `terminalValuationModelVersion`, `terminalValuationInputEvidenceIds`, and four independent evidence-observation timestamps (`underlyingObservedAt`, `optionInputsObservedAt`, `volatilityInputsObservedAt`, `eventStateObservedAt`). `classifyTerminalValuationPitSafety` requires ALL FOUR to be known and `<= horizonTimestamp`; `buildAnalyticalTerminalValuation` only invokes the caller-supplied mark computation when that check passes, and otherwise short-circuits to `terminalValuationProvenance: 'TERMINAL_VALUATION_NOT_IDENTIFIABLE'` (mark `null`) WITHOUT computing anything from out-of-window evidence. A missing evidence timestamp is treated as a violation, never assumed safe by omission. This module is the only legal path to producing an `ANALYTICAL_MTM_AT_HORIZON` figure for this study -- today's Optionomics surface must never be used to value a historical open position.

## Outcome variables

Primary: return per capital-day (whole-chain after-cost net P&L / average capital committed / calendar days in the common horizon), computed independently per branch over the SAME horizon window. Secondary: raw whole-chain after-cost net P&L over the horizon, assignment rate per calendar day of exposure, aggregate transaction cost over the horizon, Expected Shortfall of the horizon-level return distribution, cycle count (how many discrete option cycles each branch completed -- reported, not treated as a merit metric itself), max drawdown within the horizon.

## Capital denominator

Average capital committed across the horizon window (time-weighted, not a single point-in-time snapshot) -- since Hold-Strike's capital commitment may plausibly be lumpier (short bursts of commitment between very-near-dated cycles) than Conventional's (one longer, steadier commitment) -- itself an empirical question, not assumed -- a naive point-in-time denominator could misrepresent either policy's real capital efficiency. Uses the single canonical `CapitalDays`/`ReturnPerCapitalDay` definition (`src/research/capital-days-definition.ts`) -- the same definition any other R8 study computing capital-days must use, never an alternate ad hoc formula for this study specifically.

## Transaction-cost treatment

Every discrete cycle within the horizon (for either branch) contributes its own real fee/TCA to the aggregate -- Hold-Strike's higher cycle count is not smoothed away or averaged; if it genuinely costs more in aggregate execution cost, that cost is fully counted, exactly once per real cycle, never estimated from a single-cycle cost multiplied by an assumed cycle count.

## Assignment/recovery treatment

Identical whole-chain lifecycle discipline to v1: an assignment on either branch triggers the SAME STOCK_HELD -> RECOVERY_WAIT -> (SELL_STOCK or CC path) -> CASH/REDEPLOY lifecycle, scored as part of that branch's own horizon-level outcome. IF Hold-Strike realizes more assignment events within the same horizon than Conventional (an empirical question, per H2a above, not assumed), the horizon-level aggregation must sum ALL assignment/recovery episodes within the window for that branch regardless, never just the most recent one -- this aggregation rule applies unconditionally, independent of whichever hypothesis about relative assignment frequency turns out true.

## Chronological split

Identical discipline to v1 and the fixed-vs-adaptive protocol: chronological walk-forward, embargo overlapping horizon windows, untouched final OOS window, protocol frozen before that window is observed.

## Minimum evidence expectations

Given the common horizon is calendar-time-based (not cycle-count-based), the effective independent N is the number of NON-OVERLAPPING horizon windows across the study period, clustered by underlying -- not the number of individual option cycles (which would badly overstate independence for Hold-Strike specifically, given its much higher cycle frequency within one horizon). No minimum N is pre-specified numerically here; the research owner must pre-register a power/precision analysis before any result is eligible for promotion, exactly as the fixed-vs-adaptive protocol requires. Until then every result remains `INSUFFICIENT_EVIDENCE`.

## Ablations

Feature-family ablation ladder (baseline structural fields -> +IV/RV -> +term/skew -> +dealer positioning -> +events) applies only to any conditional model explaining WHEN one policy outperforms the other, gated on PIT-qualification exactly as the other frozen protocols require, including the standing call-wall/put-wall quarantine.

## Failure criteria

The study is declared `NO_INCREMENTAL_VALUE` for Hold-Strike if, after adequate effective N, its capital-normalized return-per-capital-day is not distinguishable from Conventional's with uncertainty bounds excluding a materially adverse effect. It is declared `INSUFFICIENT_EVIDENCE` if effective N never reaches the pre-registered power target. Neither failure mode blocks closing this study honestly -- both are valid, successful research outcomes per this engagement's standing rule.

## Experiment fingerprint

Cohort filters (including the exact decision-context-pairing rule above), horizon length (to be fixed as an explicit calendar-day value BEFORE any outcome inspection begins -- not specified numerically in this document itself, since choosing it requires the same power/precision analysis noted above), feature versions, cost assumptions, capital-denominator computation method, effective-N target, confidence method, and OOS window dates must be published as an immutable fingerprint before outcome inspection begins for any specific run. Current status: `PREREGISTERED_DESIGN_ONLY`. No fingerprint has been published; no outcome data has been inspected in producing this document.
