# THETA H 3–5 DTE: draft research review

Review-only candidate-coverage proposal. The sole economic change is H entry `dteMin: 2 -> 3`; `dteMax` stays 5. A distinct strategy version identifies the challenger. Mandatory closes, no-roll, existing risk boundaries, and allowed actions remain unchanged. Status is `RESEARCH_ONLY`, execution is disabled, and promotion remains unvalidated.

## Exact artifact and source

- Proposal: `THETA_H_DTE3_5_Research_Proposal_2026-10-08.json`
- Size: 3,499 bytes
- SHA-256: `a3a312f03928006336462249e05c90c24442030bd87f99084be29c1678d80b08`
- [Pinned public source](https://github.com/smokychain22/trading-bots/tree/2cb0d470f473132e80d44c2a2c051765e525afee): `2cb0d470f473132e80d44c2a2c051765e525afee`
- Baseline: `theta-hold-strike@1.0.1-research`; configuration hash `cfdded1548790c092f6a24a00512b771780ca338fbc9a2565e860ce670dae9b3`
- Challenger: `theta-hold-strike@dot-h-dte3-5-v1`

## Evidence actually available

17 local-only assertions passed: JSON/shape and byte/hash checks, direct strategy/metadata invariants against the public example, and hashes/byte lengths of five cached public source files. The JSON receipt lists every assertion. These checks are not canonical validation.

`validateDotProposal`: NOT_RUN. `evaluateDotShadowProposal`: NOT_RUN. The previously reported execution host failed before process creation; no canonical acceptance, rejection, or canonical proposal hash was produced. Existing source tests were inspected, not rerun. No new canonical execution was attempted here.

Market observations: 0. Qualified episodes: 0. Actual fills: 0. Historical replay: NOT_RUN. Out-of-sample performance: UNKNOWN. Expectancy: unknown. Source inspection and synthetic fixtures cannot establish profitability.

## Required paired test, still NOT_RUN

1. Validate the unchanged artifact against pinned source. Pair a canonical 2–5 DTE control and 3–5 DTE challenger using identical point-in-time inputs, routing, source IDs and evidence; verify matching input hashes.
2. Include DTE 1–6 boundaries. Challenger accepted contracts must equal baseline accepted contracts restricted to DTE 3–5. Retained contracts must preserve economics, quantity and eligibility exactly. Compare quantity only where the output actually provides it.
3. Record every baseline-eligible 2-DTE exclusion and its rejection reason; distinguish pre-existing rejected contracts from coverage loss. The baseline registry must remain unchanged.
4. Exercise existing admission gates for unknown required metadata, stale quotes, mismatched timestamps, missing evidence IDs/chains, ineligible routing, unsupported models, unknown baselines, expansions and risk-boundary changes. Record actual results; do not treat this plan as a pass.
5. Exercise stale/mismatched feature evidence in separate existing rule-bearing fixtures. This proposal has `researchRules: []`; unused feature evidence is not automatically rejected for staleness. Preserve fail-closed behavior wherever qualification is actually required.

## Review boundaries

This is separate from the same-entry net-50 primary/net-80 secondary exit study. It neither implements nor validates that study. `plannedHoldingDays=10` and `FIXED_10/FIXED_50` remain unconsumed public-example metadata, not a verified H hold policy or authority to outlive mandatory closes. Do not route this proposal to `persistDotExitComparison`.

A draft PR requests review only. It does not authorize merge, deployment, private persistence, account integration, broker access, Paper/live activation, or execution. Recheck target-source compatibility if the review branch differs from the pinned source.
