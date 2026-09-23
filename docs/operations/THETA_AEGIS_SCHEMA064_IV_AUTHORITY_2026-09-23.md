# THETA schema-064 Alpaca contract-IV authority, September 23

This is a source and authenticated-read receipt. It does not authorize a Paper order, a live order, or follower execution. No migration, full backup, broker mutation, threshold relaxation, or worker restart was performed while producing it.

## Implemented

- A separate `ALPACA_CONTRACT_IV_COHORT_SHOCK` detector uses exact OCC identity, Alpaca IV and Greeks, an exact-contract Alpaca BBO, an explicit OPRA or indicative feed, and a fresh Alpaca IEX underlying quote solely to classify moneyness. Its IV timing is THETA snapshot receipt, never an invented provider IV as-of.
- Historical observations require explicit Alpaca IV, quote, feed, and underlying-reference lineage in the existing immutable schema-064 candidate PIT JSON. Older rows without that lineage are excluded. Cohorts match underlying, option type, option feed, DTE bucket, and moneyness bucket. Repeated scans of a contract contribute at most once per session, and one session contributes one median IV to the baseline.
- The threshold numbers are the prior Paper bootstrap values, 0.03 absolute increase, 0.25 relative increase, and robust Z of 3. They have a new methodology-specific version and are not empirically optimal. A zero-MAD baseline has the existing explicit absolute-and-relative fallback. Zero historical sessions remain `BASELINE_NOT_STARTED` and cannot use the governed accumulating-baseline exception.
- To bound immutable snapshot size on the small Aiven plan, each session stores the first eight sorted evidence IDs and source hashes as an explicitly truncated sample, plus hashes of the full sorted ID and source-hash sets, the full count, and the first/last observation times. The source candidate PIT rows remain the replayable full lineage.
- New candidate evidence persists IV source, availability, provider-time absence, feed, and authority. The FusionSnapshot persists a per-contract detector assessment, hash, maturity, source timing, and a descriptive side-by-side Optionomics comparison. Paper-plan assembly reads the committed exact-contract assessment and validates its hash, identity, timing, policy, and READY or governed accumulating state. An in-memory assessment grants no Paper authority.
- The existing Optionomics ATM-IV detector remains separate research. Its missing provider as-of and unapplied migration 065 do not become an Alpaca IV fallback. The existing AEGIS, event, quote, sizing, and broker gates remain unchanged.

## Authenticated read-only evidence

- Aiven PostgreSQL 18.6 accepted TLS, ordinary SELECT and a rollback-safe temporary write probe. Both transaction read-only settings were `off`. The preflight saw 15 of 20 connections in use. No migration was applied.
- The schema-064 candidate PIT and derived risk-history view each contained 19,350 rows. A bounded recent-cohort read found zero source-proven Alpaca IV rows for the sampled SHOP and SCHW cohorts. It found 4,996 SHOP and 2,091 SCHW numeric-IV rows without provable Alpaca IV source in that bounded read. Those rows were excluded. Their historical moneyness was unavailable, so no spread cohort qualified in the sampled read. These are sampled counts, not a database-wide declaration.
- An additional costly view diagnostic hit the bounded PostgreSQL statement timeout `57014`. It was not retried. No inference about historical spread quality was made from that timeout.
- The explicit local provider-readiness path returned HTTP 200 for Alpaca Paper account, clock, calendar, IEX stock data, option contracts, indicative options data, positions, open orders, account activities, and corporate actions. Alpaca OPRA returned HTTP 403 and remains separately `NOT_ENTITLED`. Optionomics authenticated reads succeeded, but no provider IV as-of was established.

## Verification and limits

- The focused detector, normalization, candidate-specific AEGIS, and shadow-cycle tests passed. The full Node suite passed 2,074 tests with 14 skips, and 610 Python tests passed. Typecheck, lint, build, and security scan passed. The PostgreSQL persistence test was added but remains a local skip because no disposable `TEST_DATABASE_URL` is configured. It must pass in CI against disposable PostgreSQL before a release claim.
- Current Production rows cannot be back-labelled as Alpaca IV. New source-proven rows require a current deployed producer and real open-session observations. With zero prior source-proven sessions in the sampled cohorts, the detector remains `BASELINE_NOT_STARTED`, which blocks new risk under the existing policy.
- The running Windows worker was read as `853beb4fde989c2f6deb83ad9cb13a9a3e87e76a`, `MASTER_THETA_PAPER`, `ONLINE`, gate `LOCKED`. This source has not been observed by that worker. Company/earnings and corporate-action negative assurance remain separate Paper blockers.

Next release proof: CI disposable-PostgreSQL persistence, immutable Production deployment with locked execution flags, one-worker SHA alignment, and naturally observed open-session IV/BBO/underlying-reference evidence. Do not force a candidate or order.
