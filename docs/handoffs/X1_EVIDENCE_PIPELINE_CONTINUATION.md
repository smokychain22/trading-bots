# X1 evidence pipeline continuation

Frozen inputs verified 2026-09-18: main `88a277ba1010c9b2f9249e387c0708cd4ab8cfc5`, adapter baseline `d8c3bb27762b949dba18817dc9d21b2565064520`, C1 `53a23a707c57f96a47a481e5e2dbd4b824978254`, excluded C2 `03e025b3af42cfa08de59406089a69c05a189e6d`.

## Implemented

- Whole-chain loads bind canonical bot/account/provider identity to the requested connected master Paper account. Missing or mismatched ownership has the same not-found response.
- Broker symbol quantity reconciles against aggregate same-account stock lots. Each chain retains its own lots. Drift produces UNKNOWN with `BROKER_LIFECYCLE_DRIFT`.
- Production action handoff persists its actual `INITIAL_LIMIT` quote before broker submission. This is an order-handoff benchmark, not a reconstructed earlier strategy-decision quote. Intent foreign keys retain decision, chain, contract, and account linkage.
- The post-reconciliation lifecycle job computes TCA only for complete confirmed fills with persisted reference quotes. Missing quotes remain missing. Fill-time BBO is never invented. Evidence failures return sanitized scheduler degradation codes after broker/lifecycle transactions, without broker retries.
- TCA retains the existing signed mid-benchmark convention. Positive shortfall is adverse for both sides. The historical handoff mid is a benchmark, never an assumed execution. Paper indicative provenance stays explicit.
- Fully confirmed roll closes now persist immediately in `ROLL_DECISION`. Resuming the open links the successor while preserving the original realized loss and close timestamp. Partial closes remain unresolved, with broker fills retained and no new roll leg authorized by this change.
- The adapter detects missing roll successors while preserving known old close costs. Future successor references are excluded at earlier as-of cutoffs.
- Migration 057 adds nullable account-level cash activity amounts. Parsing preserves signed cash and explicit zero, rejects malformed numbers, and does not infer chain allocation.

## Cash evidence semantics

Alpaca documents signed `net_amount` and optional dividend `per_share_amount` in [Trading API account activities](https://docs.alpaca.markets/us/docs/account-activities). These are account cash facts. Its documented FILL contract does not establish an explicit per-fill fee value. Existing null fill fees remain UNKNOWN. A schema default or absent fee record is not evidence of zero.

Broker DIV cash has not been allocated to a chain by ticker/payment-date heuristics. Without entitlement/record-date allocation evidence, chain dividends remain UNKNOWN. Old activity rows lacking cash columns are not retroactively presented as captured cash values. A controlled historical backfill requires separate provenance validation.

## Acceptance still required

This document is not an X1-complete or Paper-activation receipt. Real PostgreSQL regressions must pass in CI. Runtime integration of frozen C1, policy language dependency audit, safe Production migration/deployment, worker restart, current provider/broker checks, and first-canary readiness have not been performed by this change.

Known boundaries: partial-close realized accounting still needs its own acceptance proof. Aggregate inventory uses the canonical trading-account ID, and current broker marks remain account reconciliation observations. TCA retries skip existing immutable intent records. Conflicting concurrent inserts surface evidence degradation and do not overwrite prior TCA.

## Verification

Local full Node run: 961 passed, 11 disposable-database tests skipped, zero failures before the additional interrupted-roll unit assertion. TypeScript, lint, build, and security scan passed. Full CI is required for the final commit, including PostgreSQL lifecycle, adapter and TCA tests, Redis, Python and Playwright.

Reticle is not applicable to this backend-only change. No UI flow was changed.

CI acceptance for implementation commit `55e2e79b7eb223603182155c199892dda0ec21a6`: run `35350349496` passed all steps, including real PostgreSQL migration/invariant and persistence tests, Redis, Python and Playwright. Migration 057 was applied only to the disposable CI database, not Production.

## Concrete activation safety issues

1. A partially filled close that becomes canceled/rejected is retained in broker fill evidence but does not yet have canonical partial realized-P&L application. The existing fully-filled lifecycle router intentionally returns PARTIAL. This must not be represented as complete lifecycle support.
2. Frozen C1 `computeWholeChainPnl` subtracts `components.slippage`, while this adapter obtains option credits/debits from actual broker fill prices. Passing measured TCA shortfall directly would double-charge embedded execution effects. Example: actual $200 opening credit less actual $150 closing debit is $50 before explicit fees. A $10 diagnostic benchmark shortfall is already represented in those fills and must not turn realized cash P&L into $40. Integration must explicitly distinguish benchmark-priced hypothetical cashflows from actual-fill cashflows and retain TCA as a separate diagnostic for the latter.

These findings keep X1 final acceptance and X2/X3 activation incomplete. No policy promotion, main merge, Production migration/deployment, or order was performed. No owner secret or new provider is needed to correct them.

OWNER: Codex. No main merge, Production migration, deployment, worker change, or broker mutation is authorized by this receipt alone. The owner's conditional Paper authorization remains subject to the specified phase gates. Followers remain locked and live money remains forbidden.
