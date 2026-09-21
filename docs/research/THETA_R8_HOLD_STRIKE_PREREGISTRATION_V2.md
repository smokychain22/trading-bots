# R8 Hold-Strike preregistration v2

Status: research protocol only, frozen BEFORE any Hold-Strike outcome data is examined or tuned against. Supersedes `THETA_R8_HOLD_STRIKE_PREREGISTRATION.md` (v1) for empirical purposes, per `THETA_R8_HOLD_STRIKE_PREREGISTRATION_ERRATUM.md`'s finding that v1's "same strike/expiration" pairing is structurally unsatisfiable (`THETA_HOLD_STRIKE`'s real DTE lattice, 2-5 days, does not overlap at all with `THETA_CONVENTIONAL`'s, 25-60 days -- `strategy-package.ts`, verified this session). **Neither v1 nor the erratum is edited or deleted; both remain on record.** No Hold-Strike outcome data has been examined at any point before this v2 document, confirmed in the erratum. Registered against canonical main `bf6d80ec71315cb822db87d2f53ecda949e18d25` on 2026-09-22.

## What v1 got right, kept unchanged in v2

The candidate SHAPE claim (`singleLegPutCandidate`, one short put, `action: 'OPEN_CSP'`, identical economics fields) is accurate and unchanged. The outcome definition (whole-chain after-cost, both branches' own management path independently), censoring convention (`label_available_at = None` for open/unresolved chains), cost treatment (real fees/TCA, both directions), lifecycle treatment (roll-immutability), and split policy (chronological walk-forward, embargoed) all remain valid and are inherited from v1 without change.

## What v2 changes: the pairing structure

v1 required an identical contract (same strike, same expiration) between the two branches -- impossible given the disjoint DTE lattices. v2 abandons "same contract" pairing entirely and instead pairs on **decision context**, matching the directive's own suggested structure:

- **Same underlying, same decision time** -- both branches' evaluation runs against the identical point-in-time universe/ownership/regime snapshot (the SAME `FusionSnapshot`, not merely the same calendar day).
- **Same ownership eligibility** -- both branches must be structurally eligible to trade the underlying at that decision time (`assessUniverseEventEvidence`/AEGIS state identical for both, since they share the decision context).
- **Same market/regime state** -- both branches see the identical volatility/trend/event-proximity regime classification at decision time.
- **Strategy-specific valid DTE lattice** -- Conventional evaluates its real 25-60 DTE lattice; Hold-Strike evaluates its real 2-5 DTE lattice. Neither is forced onto the other's window. This is the core structural change from v1.
- **Common whole-chain outcome horizon** -- both branches' outcomes are measured over the SAME calendar window from decision time (e.g. 90 calendar days), regardless of how many discrete option cycles each branch completes within it. Conventional will typically complete ~1-2 cycles in that window; Hold-Strike, given its much shorter DTE, may complete many more. This is deliberate: the comparison question becomes "which policy produces better economics over a fixed calendar period," not "which policy produces better economics per single option cycle" -- the latter comparison is exactly what v1 could never construct honestly, and inventing an artificial single-cycle equivalence would just reintroduce the same flaw under a different name.
- **Capital-normalized economics** -- because Hold-Strike's shorter DTE structurally means less collateral committed per calendar day than Conventional's longer-dated position (all else equal), the primary outcome is return-per-capital-day over the common horizon, not raw P&L -- otherwise a policy that simply commits more capital for longer would look superior for a reason that has nothing to do with the strategy difference being studied.

## Primary hypothesis

Over a fixed common calendar horizon, on the same underlying/decision-context pairs, does `THETA_HOLD_STRIKE`'s much-shorter-DTE, hold-toward-strike policy produce superior capital-normalized whole-chain after-cost economics (return per capital-day) compared to `THETA_CONVENTIONAL`'s longer-DTE, earlier-defensive-management policy -- net of Hold-Strike's structurally higher cycle-turnover transaction costs (more, smaller trades over the same horizon means more individual execution-cost events)?

H1 (favorable): Hold-Strike's capital efficiency (less collateral tied up per calendar day) and premium-collection frequency outweigh its higher aggregate transaction-cost burden and higher assignment frequency (a much shorter DTE structurally means more decision points where the underlying could be near/at the strike).
H2 (unfavorable, the honest null): Hold-Strike's higher trade frequency's transaction-cost and assignment/recovery burden erode any capital-efficiency advantage, making it dominated by Conventional on a risk-adjusted, capital-normalized basis.

No claim is made about which is true.

## Secondary hypotheses

- H2a: Hold-Strike's assignment rate is materially higher than Conventional's per calendar day of exposure (a direct, testable structural consequence of its DTE difference, not itself an economic value judgment).
- H2b: Hold-Strike's aggregate execution cost (sum of all cycle transaction costs within the common horizon) exceeds Conventional's by more than its capital-efficiency advantage compensates for.

## Population

Decision-time snapshots where BOTH branches are structurally feasible (per `strategy-timing-router.ts`'s CASH_AVAILABLE eligibility) on the same underlying, with complete PIT evidence for both (no UNKNOWN hard-safety gate for either). A snapshot where only one branch is feasible is excluded from the PRIMARY paired analysis and reported separately as an unpaired observation.

## Exclusions

Snapshots with incomplete event/corporate-action evidence (per the standing fail-closed universe-policy gate); snapshots where AEGIS state differs between the two branches' evaluation somehow (should not happen given shared decision context, but verified, not assumed); any chain still open (censored) at the horizon boundary for either branch.

## Outcome variables

Primary: return per capital-day (whole-chain after-cost net P&L / average capital committed / calendar days in the common horizon), computed independently per branch over the SAME horizon window. Secondary: raw whole-chain after-cost net P&L over the horizon, assignment rate per calendar day of exposure, aggregate transaction cost over the horizon, Expected Shortfall of the horizon-level return distribution, cycle count (how many discrete option cycles each branch completed -- reported, not treated as a merit metric itself), max drawdown within the horizon.

## Capital denominator

Average capital committed across the horizon window (time-weighted, not a single point-in-time snapshot) -- since Hold-Strike's capital commitment is structurally lumpier (short bursts of commitment between very-near-dated cycles) than Conventional's (one longer, steadier commitment), a naive point-in-time denominator would misrepresent either policy's real capital efficiency.

## Transaction-cost treatment

Every discrete cycle within the horizon (for either branch) contributes its own real fee/TCA to the aggregate -- Hold-Strike's higher cycle count is not smoothed away or averaged; if it genuinely costs more in aggregate execution cost, that cost is fully counted, exactly once per real cycle, never estimated from a single-cycle cost multiplied by an assumed cycle count.

## Assignment/recovery treatment

Identical whole-chain lifecycle discipline to v1: an assignment on either branch triggers the SAME STOCK_HELD -> RECOVERY_WAIT -> (SELL_STOCK or CC path) -> CASH/REDEPLOY lifecycle, scored as part of that branch's own horizon-level outcome. Given Hold-Strike's much shorter DTE structurally implies more assignment EVENTS within the same horizon (each individually smaller/shorter in duration than a typical Conventional assignment), the horizon-level aggregation must sum ALL assignment/recovery episodes within the window for that branch, never just the most recent one.

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
