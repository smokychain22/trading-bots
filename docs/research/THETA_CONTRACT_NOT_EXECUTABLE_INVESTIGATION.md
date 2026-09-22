# THETA `CONTRACT_NOT_EXECUTABLE` special investigation

Status: Directive-mandated special investigation. Grounded in an exhaustive
read of `option-contract.ts`, `option-chain-ingestion.ts`,
`alpaca-provider.ts`, `new-risk-orchestrator.ts`, a repo-wide search for any
real captured Alpaca payload, and -- **as of Wave 4** --
`docs/operations/THETA_PRODUCTION_CLOSURE_WAVE1_2026-09-22.md` (Codex's own
real evidence receipt, produced via a read-only Aiven query,
`tools/windows/dr/Inspect-ThetaCandidateFunnel.ps1`, against the real
`trade.shadow_opportunity`/`trade.candidate_point_in_time_evidence` tables --
no synthetic candidate, broker mutation, or write query was used). **This
resolves the root cause this pass previously left open.**

## RESOLVED this pass: the real breakdown, from Codex's own persisted-data query

| Cause | Rows |
| --- | ---: |
| `quote stale; spread too wide` | 2,014 |
| `spread too wide` | 787 |
| `quote stale` | 498 |
| **Total `CONTRACT_NOT_EXECUTABLE`** | **3,299** |

This sums exactly to 3,299. **The multiplier-only hypothesis is REJECTED**,
confirmed independently by Codex: "A sample persisted contract has
multiplier 100, an `INDICATIVE` bid/ask, and a provider quote timestamp."
The real dominant causes are quote staleness (>30s age) and excessive
relative spread -- exactly the two conditions this investigation's own
10-condition gate table already named as plausible, now confirmed as the
real dominant ones by direct evidence rather than hypothesis.

## New classification: OBSERVED_REJECTION_CAUSE_KNOWN vs. POLICY_CORRECTNESS_NOT_YET_PROVEN

Per this wave's directive, these are two SEPARATE questions and must not be
conflated:

- **OBSERVED_REJECTION_CAUSE_KNOWN = YES, RESOLVED.** We now know exactly
  what rejected the 3,299 candidates: staleness and spread-width, not a
  multiplier mapping defect.
- **POLICY_CORRECTNESS_NOT_YET_PROVEN = still open.** Codex's own receipt:
  "The contract-level gate enforces 30-second age and a versioned maximum
  spread. These observations do not justify relaxing either gate." Whether
  the 30-second quote-age policy, the maximum relative-spread policy, the
  `INDICATIVE`-vs-`OPRA` feed behavior, scan timing, or candidate breadth are
  properly CALIBRATED for real Paper operation remains an open, separate,
  unresolved question -- do not report this root cause as "completely
  solved" until that second question is answered. This is Codex's own
  explicit position, not merely a suggestion added by this research branch.

## The real gate has 9 independent conditions, not just "multiplier missing"

`normalizeOptionContract` (`src/theta/option-contract.ts:210-224`) computes
`executable` from a `reasons[]` array with **8 independent conditions**, ANY
of which sets `executable=false`:

| Condition | Line |
| --- | --- |
| `raw.source !== 'ALPACA'` | 212 |
| feed not in `['OPRA','INDICATIVE']` | 213 |
| `dte <= 0` (expired) | 214 |
| `raw.bid === null \|\| raw.ask === null` ("quote unavailable") | 215 |
| `quoteAgeSeconds === null` ("quote age unknown") | 216 |
| quote timestamp invalid/future | 217 |
| `quoteAgeSeconds > maxQuoteAgeSecondsForExecutable` ("quote stale") | 218 |
| crossed/invalid BBO (`bid<0 || ask<=0 || bid>ask`) | 219 |
| spread unknown or `> maxSpreadPctForExecutable` | 220-221 |
| `dataQuality !== 'GOOD'` | 222 |

Plus a **10th, layered on top at the ingestion level**
(`option-chain-ingestion.ts:154-161`): `contract.multiplier === null` forces
`executable=false` regardless of the above.

## The single most likely real explanation: unquoted contracts, not a multiplier mapping bug

`option-chain-ingestion.ts:139` sets
`dataQuality: snapshot !== null ? 'GOOD' : 'UNKNOWN'`. A contract with **no
snapshot entry at all** (never quoted/fetched) simultaneously fails 4 of the
8 conditions (`bid/ask null`, `quote age unknown`, `spread unknown`,
`dataQuality UNKNOWN`). This is the single most statistically likely
explanation for a large `CONTRACT_NOT_EXECUTABLE` count in a wide-lattice
scan: most strikes/expirations far from the target band are simply never
quoted at all -- normal option-chain behavior, not a defect -- OR this
correlates with the 2026-09-21 session's confirmed `HTTP_503`/Aiven
degradation window (many snapshot fetches failing that specific day).

**The earlier "multiplier" theory (from a prior pass of this engagement) is
one of ≥10 possible causes and is NOT verified as dominant.** It should not
be treated as the leading hypothesis without further evidence.

## `new-risk-orchestrator.ts` collapses all conditions into one bucket for counting -- but the granular cause is still preserved per-candidate

`new-risk-orchestrator.ts:412-430` collapses ALL 10 conditions into one
`CONTRACT_NOT_EXECUTABLE` bucket for the aggregate count reported in the R7
forensic. **But the granular cause (`nonExecutableReason`, a joined reason
string) is preserved per-candidate in the persisted shadow record**
(`new-risk-orchestrator.ts:709`, `reasons: entry.reasons`).

**This means Codex does not need a fresh live Alpaca pull to resolve this.**
If the 2026-09-21 session's shadow evidence rows are still readable (pending
the Aiven write-availability recovery already being worked), a `GROUP BY` on
the persisted `reasons[].detail` string for that session's
`CONTRACT_NOT_EXECUTABLE` rows will give an exact breakdown by real cause
using existing, already-persisted data.

## No parser defect found

`asNumberOrNull` (`alpaca-provider.ts:85-89`) correctly handles both numeric
and string inputs via `Number(value)` -- a string `"100"` parses fine.
`docs/research/HISTORICAL_OPTIONS_DATA_GAP.md:76` confirms
`/v2/options/contracts` is "implemented with pagination and null-preserving
multiplier parsing" (an intentional design, not a bug) but does not state how
often the real `size` field is actually null for real liquid contracts.

Only a synthetic test fixture exists (`tests/alpaca-provider.test.ts:185`,
`size: '250'`) -- **no real captured Alpaca payload exists anywhere in this
repository.**

## Access boundary, confirmed

This research environment has no Alpaca MCP tool or live credential access.
Steps requiring a live Alpaca pull (confirming real `size` field frequency
across real contracts) are genuinely **ACCESS_BOUNDARY** for this branch.
Everything else in this investigation (parser logic, the full 10-condition
gate, the persisted-reason-preservation fact) required no live access and was
completed via direct source reads.

## Exact Codex verification request (step 1 RESOLVED this wave; step 2 remains open)

1. ~~Run a breakdown of persisted `CONTRACT_NOT_EXECUTABLE` shadow rows
   grouped by their `reasons[].detail` string.~~ **DONE by Codex this wave**
   -- see the resolved breakdown above.
2. **Still open, still requires real policy judgment, not a code investigation**:
   is 30-second quote-age and the current versioned maximum-spread policy
   correctly calibrated for real Paper operation, given that 2,014+787+498
   real candidates were excluded by exactly these two conditions in one
   session? Codex's own receipt takes no position beyond "these observations
   do not justify relaxing either gate" -- that is a statement that the
   observed rejection rate alone isn't sufficient grounds to loosen the
   gates, not a statement that the current calibration is proven correct.
   This remains `POLICY_CORRECTNESS_NOT_YET_PROVEN` and is a Codex/owner
   policy decision, not something this research branch can resolve or
   should recommend a specific number for.

Root cause: **RESOLVED**. Policy calibration: **OPEN**. Do not conflate the
two when reporting this item's status.
