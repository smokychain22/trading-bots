# X1 runtime evidence release review

Review date: 2026-09-18.

Canonical main inspected: `88a277ba1010c9b2f9249e387c0708cd4ab8cfc5`.
Adapter branch baseline: `6b9224f5e3f0217614e90143c08fd1094eab578e`.
Claude candidate observed: `53a23a707c57f96a47a481e5e2dbd4b824978254`.
The Claude candidate has not been accepted or integrated by this review.

## Fixed and tested in this change

- `PostgresExecutionEvidenceStore.recordTca` had 25 value placeholders for 24 columns and misplaced JSON casts. Corrected the INSERT.
- A confirmed fill can retain actual price, direction-aware shortfall, multiplier, and latency without a fill-time BBO. Missing fill BBO produces `FILL_BBO_UNKNOWN`, null fill spread, and null spread capture.
- Indicative benchmarks remain `ALPACA_INDICATIVE_TCA`. No NBBO qualification is implied.
- The disposable PostgreSQL adapter test now uses the actual TCA writer rather than a handwritten INSERT, and checks identical replay, quote semantics, and unknown fill BBO.

## Current release blockers, not completed features

1. Runtime search finds no callers of `recordPriceEvent` or `recordTca` in `src` outside their declarations. Decision/arrival quote capture and confirmed-fill TCA dispatch must be connected before claiming runtime TCA coverage. Historical benchmarks must not be reconstructed from current quotes.
2. The whole-chain repository accepts a connection ID without verifying that the connection owns the chain. Bind the master role, broker identity, execution account, and chain before attaching evidence to canonical management.
3. Broker stock quantity is account-wide for a symbol, while `reconcileOpenShares` compares it with one chain's shares. Reconcile aggregate same-account inventory first, then preserve chain lot allocation. Never attribute account-wide shares to every chain.
4. Roll lineage validation checks successors against predecessors but does not prove every closed rolled leg has a valid successor. Interrupted rolls must remain incomplete, not imply a complete economic chain.
5. Broker activity parsing currently omits cash amounts, and fill persistence writes null fees. Dividend coverage and unambiguous fee attribution remain incomplete. Empty records do not prove zero. Do not attribute dividends by symbol/time proximity alone.
6. The immutable TCA table has one row per intent. Runtime dispatch needs terminal-fill completeness, deterministic replay identity, and explicit conflict handling before insertion. TCA failure must not undo committed broker reconciliation.

These are internal engineering and evidence defects. They are not OPRA, future profitability research, or owner-authorization blockers. X1 remains incomplete. Do not advance to X2 integration or X3 canary based on this patch.

## Verification and operational boundary

- Local Node suite: 956 passed, 11 database tests skipped without a disposable database URL.
- TypeScript, ESLint, build, and security scan passed. Security scan reported zero findings.
- Targeted TCA unit tests: 7 passed, including rejection of an invalid observed side when the other quote side is missing.
- Local Docker engine unavailable, including after requesting Docker Desktop startup. CI run `35347974740` passed the real PostgreSQL regression, schema invariants, Redis check, Python suite, and Playwright. No Production fixtures were inserted.
- No UI changes. Reticle visual verification is not applicable to this backend-only change.
- No migration, Production deployment, worker restart, broker mutation, policy promotion, or execution-gate change performed.
- This change submitted zero master, follower, and live orders. Lifetime broker order counts were not independently queried during this patch.
- Follower execution and live-money authorization are not enabled by this change.

## Handoff

OWNER: Codex.

TASK: Repair TCA persistence and preserve unknown fill-time market data.

NEXT REQUIRED TASK: Close the account/chain identity and inventory-attribution defects, wire persisted quote benchmarks and terminal confirmed-fill TCA with nonfatal evidence-gap reporting, then complete X1 and selectively review the frozen Claude candidate for X2. No second management provider.
