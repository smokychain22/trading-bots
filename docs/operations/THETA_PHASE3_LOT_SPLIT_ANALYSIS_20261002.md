# THETA Phase 3: lot-split accounting analysis (2026-10-02)

Status: analysis only. Nothing in this document is implemented. No tax or legal assumption is made anywhere in it.

## 1. Why this matters

The ledger records stock one assignment at a time: one `trade.stock_lot` row per assignment (`shares`, `economic_basis_per_share`,
`acquired_at`, `assignment_option_leg_id`, `disposed_at`, `disposed_price_per_share`, `realized_pnl`). A lot is disposed **whole** or not at
all. The current Paper policy (owner, 2026-10-02) is **whole-position lot accounting only**:

| Case | Today | Reason |
|---|---|---|
| SELL_STOCK of the entire chain position, one or many lots | recorded exactly (`allocateStockDisposal`, mode `FULL_POSITION`) | every lot is disposed with its own basis, so no selection rule is needed |
| SELL_STOCK part-filled, order ends before the full position is sold | NOT recorded; chain frozen (`STOCK_PARTIAL_EXIT_PENDING_RECONCILIATION`), realized-P&L attribution `UNKNOWN_PENDING_RECONCILIATION` | the ledger has no way to dispose part of a lot |
| Covered call on fewer contracts than the position holds | refused (`COVERED_CALL_WHOLE_POSITION_REQUIRED`) | a call-away would dispose part of the position |
| Call-away of a position that is a whole number of lots | recorded exactly | same allocator |

Broker truth stays authoritative for **aggregate** shares (Alpaca holds one position per symbol with a single average cost; it exposes no lot
selection). Lot attribution is therefore internal strategy attribution only.

## 2. What a lot-split ledger needs

1. **Remaining-share semantics.** A lot needs `open_shares` (or an immutable `shares_acquired` plus append-only disposal rows) so that a partial
   sale leaves a residual that keeps the same `acquired_at`, `economic_basis_per_share` and `assignment_option_leg_id`.
2. **Disposal rows.** One append-only row per disposal fill (`stock_lot_id`, `shares`, `price_per_share`, `occurred_at`, `fill_id`,
   `order_intent_id`, `realized_pnl`). `trade.stock_lot.realized_pnl` becomes derived (sum of disposal rows) instead of the single number
   written at close, which today also satisfies `CHECK (disposed_at IS NULL OR realized_pnl IS NOT NULL)`.
3. **Assignment and coverage links.** `trade.assignment_event(option_leg_id, stock_lot_id, shares, ...)` keeps pointing at the acquired lot.
   Covered-call coverage must count `open_shares`, not `shares`; a call-away must record which lots (and how many shares of each) it delivered.
4. **Dividends.** Per-lot dividend attribution must scale with `open_shares` on the ex-date, so the dividend writer (not built; FUTURE_DATA)
   needs the open-share history, not only the current figure.
5. **Reconciliation.** `sum(open_shares)` over the chain's open lots must equal the account's broker position for the underlying (minus
   shares owned outside THETA chains). Today's check (`reconcileStockShares`) already compares the totals; it would simply start returning
   RECONCILED after a recorded partial sale.
6. **Realized P&L per sale.** `(price - lot_basis) * shares_from_lot`, summed over the lots a sale touches. Whole-chain accounting adds fees
   (UNKNOWN until an owner-attested schedule exists) and keeps the old-leg P&L immutable.
7. **Idempotency and lineage.** The disposal rows carry the fill ids and order intent id; the existing `lifecycle_application.evidence_key`
   (hash of fill ids) keeps replays idempotent.
8. **Restart safety.** The application is one transaction (disposal rows, lot residual update, lifecycle transition) exactly like
   `disposeStockLots` today.

## 3. Two cases with very different policy needs

**3a. One open lot, partial sale (policy free).** With a single open lot the sold part and the remainder share one basis and one acquisition
time. The realized P&L is exact: `(price - basis) * shares_sold`. No lot-selection rule exists because there is nothing to select. This case can
be built without any owner decision, but it needs the schema work in section 2 (it cannot be done with the current table).

**3b. Several open lots, partial sale (needs an owner lot-selection policy).** Which lots (and which part of a lot) are sold changes the
realized P&L of every sale and the basis of what remains. Candidates compatible with the broker model (all are internal attribution; none changes
the broker's aggregate position):

| Policy | Rule | Effect on realized P&L / remaining basis | Notes |
|---|---|---|---|
| FIFO | oldest `acquired_at` first, ties by lot id | deterministic; sells the oldest basis first | already supported as an injected parameter of `allocateStockDisposal` |
| LIFO | newest first | deterministic | already supported as an injected parameter |
| Highest-cost first | highest `economic_basis_per_share` | realizes the smallest gain or largest loss first | not built; ties need a rule |
| Lowest-cost first | lowest basis | realizes the largest gain first | not built |
| Specific lot | the strategy names the lot (e.g. preserve the lot backing a covered call) | exact, but requires the decision layer to choose and persist the choice | needs an explicit selection input on the management action |
| Pro-rata | every lot sells the same fraction | no ordering dependence | splits every lot, so every lot needs the section 2 residual handling |

The choice interacts with: strategy attribution (which assignment's premium history a surviving lot carries), covered-call coverage (which
shares are free), realized P&L reporting, and future assignment accounting. The safest deterministic default if an owner wants a default is
FIFO with an explicit policy version stamped on every disposal row, but this document does not select it.

## 4. Migration implications

- Additive columns/tables only: `trade.stock_lot.open_shares` (backfilled from `shares`), `trade.stock_lot_disposal` (append-only, with the
  same immutability trigger pattern as `master_paper_action_plan_event`).
- Backfill must be proven idempotent; existing disposed lots become one disposal row each (`shares` = lot shares, price and P&L as recorded).
- Readers to update: `management-input-state` (open shares, basis), `postgres-whole-chain-components-repository` (realized stock P&L),
  `postgres-lifecycle-application-store.disposeStockLots`, `postgres-broker-lifecycle-orchestrator` (call-away allocation),
  `stock-share-reconciliation`, the covered-call coverage readers and the dividend writer once it exists.
- Replay: archived cycles carry stock inventory as numbers, so historical replays are unaffected.

## 5. Recommended staging

1. (Now, Paper) Keep whole-position only. A part-filled stock exit freezes the chain and is reconciled by an operator who records the
   broker truth; no lot-level P&L is invented.
2. Build the section 2 schema and the single-lot partial case (3a), behind the existing freeze, with property tests: shares conserved,
   P&L equals the sum of lot P&L, basis of the residual unchanged, idempotent replays, broker total equals the sum of open shares.
3. Only after an owner chooses a policy for 3b, add multi-lot partial sales with the policy version recorded on every row.
4. Before any live-money use, decide how this attribution relates to the broker's own lot treatment. This document makes no assumption about
   it.

## 6. Classification

| Item | Class |
|---|---|
| Lot-split schema and single-lot partial sale | FUTURE_PAPER: an enhancement, not required for Paper safety (whole-position policy plus the freeze already fail closed); it only matters once a real partial stock fill occurs, so it is scheduled after the first Paper position exists |
| Multi-lot partial-sale selection policy | OWNER_POLICY |
| Per-lot dividends | FUTURE_DATA |
| Broker-side lot treatment | PROVIDER_LIMITED (Alpaca exposes no lot selection) |
