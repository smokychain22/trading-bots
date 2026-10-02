# THETA Phase 3: main-process line review of shipped execution code (2026-10-02/03)

Reviewer: Claude main process (single writer). Classes: CORRECT, BUG (fixed), AMBIGUOUS_POLICY, MISSING_TEST (test added).

| Area | Source | Class | Note / action |
|---|---|---|---|
| Repricing driver | `management-order-repricing.ts` | CORRECT + BUG fixed | market-closed cancel guard added; terminal submitted plans were never swept (cross-session) -> `sweepTerminalSubmittedPlans`, tests in `db/phase3-sweep-and-freeze.test.ts` |
| Floor liveness | `adaptive-limit-policy.ts` | CORRECT | cancel at the economic boundary, plan closed, fresh decision next scan |
| Quote freshness | `master-paper-action-handoff.ts` | CORRECT | named windows, pre-submit cap |
| Broker/ledger share reconciliation | `stock-share-reconciliation.ts` | CORRECT | broker aggregate authoritative |
| Free sellable shares | `alpaca-stock-inventory-source.ts` | CORRECT | fresh pre-submit read |
| Lot disposal | `stock-lot-allocation.ts` | AMBIGUOUS_POLICY | whole-position only; partial multi-lot selection is OWNER_POLICY |
| Plan integrity | `action-plan-integrity.ts`, migration 068 | CORRECT | Production application pending (P3-017) |
| Plan -> order -> fill lineage | plan store, evidence store | CORRECT | |
| Recovery race | coordinator | BUG fixed | CANCEL_REQUESTED could stick when the broker reported expired/rejected -> mapped to CANCELED; cancel re-issue; 404/422 cancel re-read |
| Short-call commitment guard | `management-chain-inflight.ts` | BUG fixed | settled historical broker facts were counted as unknown commitments (would block every covered call and stock sale); now uses current-impact blocking facts |
| SELL_STOCK boundaries | coordinator, assembly | BUG fixed | part-filled stock exit could be replaced; now `PARTIAL_STOCK_SELL_REPLACE_FORBIDDEN` |
| Partial fill handling | coordinator, management-chain-inflight | BUG fixed | partial call-away was unrecordable -> P-B whole-position covered calls; P-A terminal freeze |
| Cross-session sweep | new | MISSING_TEST -> added | |
| Entry duplicate guard | plan store `readEquivalentEntryInFlight` | MISSING_TEST -> added | `db/phase3-entry-guard.test.ts` |
| Rate-limit handling | `broker.ts` | MISSING_TEST -> added | `phase3-exec-rate-limit.test.ts` |

## New-risk entry repricing (decision)

Current canonical policy submits ONE bounded DAY limit for a new-risk entry; it does not reprice. This is CURRENT POLICY, not missing
functionality. Repricing an entry could cross the Q economic floor, invalidate AEGIS sizing or chase a stale market, and no Paper fill-rate
evidence exists to justify it. Paper safety is covered without it: the entry duplicate guard prevents a second equivalent order while one
rests, and the sweep releases the chain at a terminal state. Classified EMPIRICAL_ONLY (revisit after the first Paper fills); not CODE_SOLVABLE.

## Lot-split accounting (decision)

OWNER_POLICY / FUTURE_ENHANCEMENT. Current Paper behavior cannot produce false accounting: a partial stock disposal freezes the chain and
attributes realized P&L as UNKNOWN_PENDING_RECONCILIATION. See `THETA_PHASE3_LOT_SPLIT_ANALYSIS_20261002.md`.
