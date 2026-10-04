# THETA data platform: the permanent-growth finding and the owner decision it needs

Status: **finding with measured numbers; no change made to immutable decision truth, no flag enabled, nothing deployed.**

## What was measured (not modeled)

The REAL cycle store and the REAL normalized writer were run on the 100 most recent REAL Production decisions (read only). Stored bytes per decision (`pg_column_size` of every column plus tuple overhead plus index bytes):

| Component | P50 | P95 | Max | Leaves PostgreSQL? |
|---|---|---|---|---|
| Complete cycle blob (raw replay source) | 1,047.5 KiB | 3,766.8 KiB | 3,977.9 KiB | yes, after 5 sessions (partition drop) |
| Decision context (shared surface, provider metrics, account, portfolio, provenance), stored once | 60.6 KiB | 189.8 KiB | 200.9 KiB | yes, after 10 sessions |
| Candidate rows, candidate-specific part only | 11.6 KiB | 17.5 KiB | 18.0 KiB | yes, after 10 sessions |
| **Permanent after retirement** (fusion projection 29.1, decision receipt 27.5, frontier 25.9, candidate rows 7.3, raw observation stub 5.2, branch evidence 2.8, other 4.6) | **114.4 KiB** | **144.6 KiB** | 159.1 KiB | **no** |
| Total at write time, old layout | 1,371.6 KiB | 4,951.7 KiB | 5,270.3 KiB | |
| Total at write time, new layout | 1,223.8 KiB | 4,136.6 KiB | 4,349.8 KiB | |

Point-in-time evidence itself fell from 288.6 KiB to 11.3 KiB (candidate) plus 69.4 KiB (shared context) per decision on average; per candidate P50 73.6 KiB to 25.1 KiB. On the archived legacy
evidence (14,437 real rows, 155 decisions, 5,210 rows through the SQL view) the reduction was 91 percent of stored bytes and the reconstruction exact.

### The 250 KiB P95 target

Not met, and the byte decomposition shows it cannot be met by this writer: the blob alone is 1,047.5 KiB at P50 and the surface-bearing context 189.8 KiB at P95. Excluding the blob the new layout is
181.7 KiB P50 and 349.0 KiB P95. Proposed replacement thresholds (the original is kept in the code as `HOT_BYTES_P95_TARGET` until the owner agrees): (1) *permanent bytes per decision after retirement*
P95 below 250 KiB (measured 144.6 KiB, met), and (2) the post-archive database size slope and the sessions-to-pressure horizon, which are what actually bound the database.

## The finding

At the measured 154 decisions per session the permanent part is about 15.7 MiB per session (plus runtime diagnostics, modeled at 7 MiB per session). The platform retires only what its writers move into
retiring partitions (blobs, context, candidate rows, histograms, payloads). Decision truth and the legacy research and diagnostic tables stay where they are, so the post-archive size is **not steady**:

| Scenario (measured inputs, REAL control plane, 250 sessions, starting at 2.6 GiB) | Slope | Post-archive 1y / 3y / 5y | Plan (8 GiB) reached | Gate |
|---|---|---|---|---|
| AS_WIRED (what this cutover delivers) | 15.1 MiB/session | 8.4 / 15.8 / 23.2 GiB | session ~226 | new risk first restricted at session 67, critical at 122 |
| + decision-detail tombstone (proposal) | 11.8 MiB/session | 6.7 / 12.5 / 18.3 GiB | ~382 | restricted at 123, critical at 248 |
| + tombstone + diagnostics retention (proposal) | 5.2 MiB/session | 5.3 / 7.8 / 10.3 GiB | ~847 | open all 250 sessions |

For comparison the database grows about 262 MiB per session today, so the platform is a 17x improvement as wired, but it does not make the 8 GiB envelope last. The storage governor would, correctly, start
restricting NEW risk (management is never affected) long before the allocation is exhausted. The SLO task now reports this: sessions until the pressure and critical bands at the measured slope, and a capacity-horizon
warning when the allocation is closer than three years even if the slope is inside the steady-state tolerance.

## Why this is an owner decision and not something shipped

The largest permanent items (fusion projection, decision receipt, frontier: 82.5 KiB of the 102 KiB mean) are rows of **immutable decision truth** (`core.reject_immutable_mutation` triggers, foreign keys from
orders and lifecycle). The remaining diagnostics (reconciliation snapshots) are immutable operational evidence. Tiering them changes what the TRD calls immutable, so it needs a versioned TRD revision and the
owner's approval; the project rules forbid doing it silently.

## Options, with what each costs and buys

1. **Accept the linear drift and size the plan for it.** No schema change. About 15 MiB per session; an 8 GiB plan lasts about 226 sessions, a 16 GiB plan about 740. Cheapest, recurring cost.
2. **Decision-detail tombstone** (recommended first step). After a decision's cycle blob is archived and verified, replace the derivable detail (fusion projection, receipt detail, frontier detail) by a stub carrying
   `archive_id` and content hash. Needs: a narrow trigger exemption (only those columns, only to a stub that matches a verified manifest, only past the hot window), TOAST space is reused (no file shrink needed for a
   bounded steady state), and a TRD revision. Saves about 12.4 MiB per session.
3. **Runtime diagnostics retention** (reconciliation snapshots, worker cycles). Keep every non-GOOD snapshot and the latest GOOD one permanently, compact the rest into daily aggregates after archive. Saves about 7 MiB per session; touches immutable operational evidence, so it needs the same approval.
4. **Evidence cadence policy.** Persist full evidence for material cycles and a hash-only heartbeat for unchanged WAIT cycles. Divides every per-decision number by the repeat factor; changes what evidence exists, so it is a TRD-level decision.
5. **Smaller storage contract (v4 projections).** Shrink the three projections; needs consumer analysis (management reads the receipt) and a new storage contract version.

Options 2 and 3 together make the AS_WIRED slope 5.2 MiB per session (allocation reached in about 847 sessions); the remaining slope is candidate rows and other per-decision relational rows (about 19.6 KiB per
decision), which only options 4 and 5, or a larger plan, address.

## Recommendation

Cut the platform over as wired (it removes 94 percent of today's growth and already makes every dp dataset bounded), but treat the permanent-growth decision as the next required step: decide among options 2 to 4
within the first 100 sessions after cutover, using the SLO task's horizon as the trigger. Nothing here weakens AEGIS, sizing, concentration, collateral, quote, event, reconciliation, liquidity, lifecycle or
execution-safety rules, and operational writes remain exempt from every storage gate.
