# THETA canonical export requests for Codex (Slice 11)

Status: Slice 11 of the pre-VPS master continuation directive. This document
specifies exactly what Codex must export for each pending R8 research
consumer -- an integration dependency request, never an invitation to
fabricate data on this research branch.

Every export must conform to the existing `real-data-export-contract.ts` v3
envelope (`contractVersion`, `canonicalSourceSha`, authority, `evidenceIds`
(immutable), `contentHash` (via `computeExportContentHash`/`canonicalize`),
`sourceWindow`, `featureAvailableAt`/`labelAvailableAt` where applicable,
`rowCount`, `scope` (`SYMBOL_SCOPED`/`MARKET_WIDE`/`MIXED`)) -- already built
and hardened in an earlier pass of this engagement; no new envelope format is
being requested, only new DATA within the existing one.

| Export needed | Consumer (this branch) | Current status | What Codex must produce |
| --- | --- | --- | --- |
| Event PIT export | `event-pit-canonical-export-runner.ts` (already built, real consumer exists) | **READY** -- `canonical-event-export.ts` (Codex-owned) already uses the same `theta-real-data-export-contract-v3` tag; consumer already wired | No new work needed -- this one is genuinely complete |
| IV/spread export | Not yet consumed | `AWAITING_CANONICAL_EXPORT` | A real export of Optionomics IV-term-structure/spread history rows, PIT-tagged, for building the AEGIS SYSTEM stress-signal producers (Unknown Ledger items 2/5) |
| Universe breadth export | `universe-opportunity-regret.ts` (schema built, zero real rows) | `AWAITING_CANONICAL_EXPORT` -- confirmed this engagement: no persisted `buildUniverseBreadthShadowPlan` evidence found anywhere accessible to this research branch | A real export of persisted universe-breadth shadow-plan cycles (champion/challenger symbols, funnel counts per stage) so the research schema can be run against real data |
| Correlation export | Not yet built (Slice D deferred) | `AWAITING_CANONICAL_EXPORT` | A real export of multi-position holding history across real accounts/time, for the 20/60/120-session correlation cohort tooling |
| Severe downside export | Not yet built (Slice D deferred) | `AWAITING_CANONICAL_EXPORT` | A real export of resolved chain outcomes with MAE/drawdown figures, regime-tagged |
| Management outcomes export | Not yet built | `AWAITING_CANONICAL_EXPORT`, and structurally blocked upstream anyway -- ROLL/ROLL_CC/SELL_CC never produce a real outcome to export until the candidate-source gap (P0) is closed | A real export of resolved management-decision outcomes, once the P0 candidate-source gap is fixed and real roll/CC decisions start occurring |
| Cross-strategy outcomes export | `defined-risk-vs-csp-paired-study.ts` (schema built, zero real rows) | `AWAITING_CANONICAL_EXPORT`, and also structurally blocked upstream -- no real Defined-Risk candidate generation exists yet (Strategy Router Truth Matrix finding) | A real export of paired CSP/Defined-Risk decision outcomes, once Defined-Risk entry-candidate generation exists |

## Priority ordering for Codex

1. Event PIT export -- already done, no action needed.
2. IV/spread export -- directly unblocks 2 confirmed P1 AEGIS gaps.
3. Everything else is gated behind other P0/P1 items (candidate-source wiring, Defined-Risk candidate generation) that must be resolved first, since an export of a decision path that doesn't exist yet would have zero real rows regardless of export-format correctness.
