# H research DTE lineage: implementation recommendation

## Observed result and scope

The unchanged 3–5 DTE proposal accepted both fresh, otherwise eligible synthetic inputs through `evaluateDotShadowProposal`: decision date Monday October 5, 2026 with supplied DTE 3 and expiration Thursday October 8 (consistent), and the same input with expiration Wednesday October 7 (calendar DTE 2, inconsistent). Both returned one accepted candidate and no blockers or rejections. Only expiration differed.

This is a direct research-consumer date/DTE consistency gap. The existing normalized-ingestion path derives DTE from expiration and date-only `asOfDate`; it would derive 2 for October 7 using October 5. This experiment does not demonstrate a production bypass, actual trade, real quote, or normalized-ingestion failure. Its outcome also does not invalidate the earlier numeric-lattice subset result.

## Recommended implementation, not applied

1. Reuse the existing `normalizeOptionContract` path and its canonical calendar-date semantics. Preserve the authoritative `asOfDate`, expiration date, and calendar/timezone lineage supplied by that path. Do not replace this with ceiling of elapsed hours or accept a caller's claimed numeric DTE alone.
2. Before the H research lattice filter, require original expiration and canonical as-of date to be known at the decision, with sufficient source/snapshot/timezone lineage to establish that they describe the same decision context. Reuse existing lineage fields where available; do not invent dates from later observations or blindly use the UTC timestamp's date if the canonical trading-date convention differs.
3. Require supplied DTE to agree with the existing normalizer's derived DTE for those authoritative dates. Missing, stale-for-the-decision, contradictory, or ambiguous lineage should produce a research data-gap/rejection diagnostic. “DATA_GAP” here describes a proposed outcome, not a currently implemented reason code.
4. Apply the unchanged 3–5 lattice only after this consistency check. Preserve all H ownership/event gates, quote-quality/freshness requirements, risk controls, and entry policy. This recommendation authorizes no production changes and adds no producer, strategy schema, sizing, or execution engine.

## Proposed verification cases, not executed

- Contradiction: Monday October 5 to Wednesday October 7 with supplied DTE 3 should fail the proposed consistency guard; the consistent Thursday October 8 DTE 3 control should remain eligible subject to existing gates.
- As-of date/timezone boundary: test a decision near a date rollover using the existing canonical calendar/timezone rule. Valid lineage must resolve to the authoritative as-of date; conflicting date claims must be rejected rather than silently converted with elapsed-hour arithmetic.
- Unknown as-of date: missing authoritative date or unresolvable decision-time lineage should remain a research data gap.
- Valid weekend crossing: Friday October 9 to Monday October 12 is 3 calendar days under the existing date-only convention. Consistent DTE 3 should survive the proposed consistency guard, subject to all other gates. These dates are synthetic test labels, not claims of listed or tradable contracts.

## Exact evidence boundary

One harness execution made exactly two pure-consumer calls, the control and mismatch above. No proposed guard was implemented or tested. No additional negative/boundary cases or normalizer executions were run, and the prior 78-assertion suite was not rerun.

Executed source: `2cb0d470f473132e80d44c2a2c051765e525afee`. The separately reported compatibility audit references `34b630e5814ce179cf958a0e3d70f5ee28da71b3`; this probe did not execute the newer source. Treat that audit as qualification context, not new-runtime test evidence.

Unchanged proposal artifact SHA-256: `a3a312f03928006336462249e05c90c24442030bd87f99084be29c1678d80b08`.

Canonical proposal hash: `d13341a5768535f44019c9aedfbfa2d83c0c9a5aeef465bc0410c5255e468033`.

Full synthetic causal inputs and returned receipts are in `THETA_H_DTE_Consistency_Research_Receipt_2026-10-08.json`. Execution used Node v24.19.0 with its permission model and directory-scoped read access. No broker, private database, repository or remote writes were performed.
