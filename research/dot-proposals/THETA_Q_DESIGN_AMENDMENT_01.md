# THETA Q research design v1 amendment 01

Prepared 9 October 2026 PKT, 8 October 2026 23:08 UTC. Research-design precision amendment. No new empirical result, market-data search, trading authority or runtime change.

This amendment controls the estimand, timing, benchmark and interpretation paragraphs of THETA_Q_COST_AND_STRIKE_SELECTION_RESEARCH_DESIGN.md. The original source v1 is retained unchanged at SHA-256 **ddb868fb7cae8ef20893aa0a204a49209ae1365e06805bd959dc65c2d1c4d581**. The included public v1 derivative adds a controlling-amendment banner and removes an unrelated single-episode aside; its staged byte hash is in the package manifest. Read the design and amendment together. Status remains **RESEARCH_DESIGN_ONLY / NOT_READY_FOR_EMPIRICAL_SEAL** until the explicit prerequisites below are resolved.

## Compare policies across every eligible origin

The primary policy contrast covers **all presealed baseline-eligible origins**, not only retained trades. An origin identifies underlying, decision time, expiry and delta-target stratum before the cost screen is applied.

- Baseline arm follows the frozen eligible entry and management benchmark.
- Screened arm follows the same benchmark when retained; when excluded, its assigned budget stays in the matched cash alternative through the common horizon.
- Both arms include unfilled orders, failed closes, assignment and unresolved states under the same accounting/data rules.
- A baseline-eligible origin is never removed because the screened arm rejected it or its realized outcome was unfavorable.

Report retained-trade conditional returns only as secondary diagnostics. They cannot replace the policy-level paired comparison. Opportunity origins lacking required baseline eligibility evidence are typed separately; policy-specific exclusion and missing source evidence are not the same event.

## One fixed economic horizon and separate label availability

For each matched origin, set H **before entry** to the scheduled core equity-market closing instant on its shared expiration date, using a frozen exchange calendar and America/New_York conversion. On an ordinary session this is 16:00 local time; a scheduled early close uses its calendar-defined time. The calendar version and resulting UTC H must be sealed with the origin. This is the same instant for every policy arm and sizing diagnostic.

H does not move because an assignment message, closing fill reconciliation, accounting correction or market-data receipt arrives late. Maintain economic_event_time, observation_available_at and label_available_at separately. Later records may establish what economically existed at H; they cannot import post-H prices or stock returns into H wealth. A fact first known after a policy decision cannot be used to change that decision retroactively.

The endpoint is **common-horizon wealth**, not necessarily a matured option lifecycle. At H, include cash, shares already economically owned, and remaining option assets/liabilities under a frozen qualified valuation rule. An option not yet expired or reconciled at H does not become worthless by assumption. If valid H valuation or state lineage is missing, preserve the policy pair as unresolved/censored according to the sealed data contract. Report unresolved mass and missingness; do not use complete-case deletion to create a favorable primary result. Do not extend one arm's stock valuation to the next available price while valuing another at H.

Early-exit proceeds and excluded-arm capital remain in the same cash alternative until H. A separately labeled matured whole-chain endpoint can follow a later lifecycle, but cannot be substituted for this primary endpoint.

## Single primary estimand

The primary sizing scheme is **common gross-strike-collateral budget**, with integer contracts, identical unchanged risk/cash-capacity constraints and explicit idle cash. One-contract and common-maximum-loss-budget comparisons are descriptive secondary estimands.

Within each target-delta stratum (0.10, 0.20, 0.25, 0.30), calculate the mean paired difference in net H wealth divided by the preallocated common budget over all presealed eligible origins, including screened-out cash arms. The single pooled primary effect is the average of those four stratum means with fixed weights **0.25 each**. Do not reweight toward a favorable or larger stratum after outcomes. If a stratum lacks valid support, or missing outcome mass prevents identification, the pooled primary result remains unresolved; do not renormalize the remaining weights.

Use dependence-aware time blocks and underlying clustering for the pooled confidence interval. Bucket/sizing breakdowns are descriptive. Any later claim of separate bucket-level efficacy requires predeclared multiplicity control and a new analysis label; it cannot rescue a failed pooled primary contrast. The same rule applies to the 10% and 30% cost-cap sensitivity checks.

The **20% cost cap remains an arbitrary preregistered research constant**, not a calibrated optimum or evidence of edge. The capital hurdle remains an unresolved externally justified input; if absent, a cost-only experiment must be separately sealed before outcome access. The 45-DTE targeting choice is likewise a declared cohort design, not an optimal horizon finding.

## Pin the management benchmark and preserve missing prerequisites

The discretionary early-profit benchmark is the existing **FIXED_50 gross-premium-capture benchmark**, not an unspecified or net-of-cost 50% rule. Pin:

- Source SHA: d0b479f3dfd0a6d9a1e79a699308cab09ed9f1ba
- Definition: src/research/profit-taking-experiment.ts; contract version theta-profit-taking-experiment-v2; file SHA-256 7d09410c383d43784f09794ed926200cb903a9695ed3de175ec6164aac5bc749
- Replay: src/research/profit-taking-replay.ts; result version theta-profit-taking-replay-v2; file SHA-256 4ada7550296c04e8f5787d242dcc81dfdce157f3a55256aa50ebe26359ef5e6f

The existing benchmark tests gross capture against an eligible close ask; costs are reported separately. Its results are estimated, not actual fills. It does not itself supply a complete operational management stack or authority. Before any empirical seal, bind the unchanged mandatory risk/event/assignment precedence, supported session, eligible quote clock, close-at-H handling, cash accrual and valuation rules to exact versions/hashes and prove that every arm uses them identically. Until then, this amendment is a precise study specification with open implementation prerequisites, not a runnable validated proposal. No gate may be weakened to implement it.

## Premium ceiling and research-study interpretation

(C−D)/(B×H_duration) is a scenario ceiling for the **option-premium component under the assumed friction budget**, not an upper bound on whole-chain common-horizon wealth. Early assignment followed by retained-stock appreciation can produce chain profit exceeding opening premium. Stock downside, dividends, interest, financing and post-assignment cash flows belong in the primary wealth ledger rather than inside a fictional premium ceiling.

The Goyal–Saretto source reports that **16 strategies retain statistically significant net returns under its cost assumptions**, while no strategy has significant factor-adjusted alpha after those costs. Absence of significant alpha does not mean every strategy's net return is negative. Neither statement establishes Q performance or a delta recommendation; the distinctions between return, factor alpha and cash-secured wealth remain essential.

## Seal checklist and current conclusion

Open prerequisites: qualified rights-cleared point-in-time data; complete opportunity-origin registry; fixed calendar/cash/valuation specification; exact unchanged mandatory-management stack and its precedence; preallocated budget and capital hurdle mandate; missingness handling and dependence-aware inference plan. No empirical results have been admitted or optimized.

Existing 14 synthetic arithmetic checks remain valid but do not test this entire policy estimator or assignment/valuation implementation. No additional test count is claimed. No single-episode performance or causal inference is claimed.
