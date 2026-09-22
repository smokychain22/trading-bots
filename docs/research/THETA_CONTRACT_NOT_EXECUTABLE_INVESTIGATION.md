# THETA `CONTRACT_NOT_EXECUTABLE` special investigation

Status: Directive-mandated special investigation, this pass. Grounded in an
exhaustive read of `option-contract.ts`, `option-chain-ingestion.ts`,
`alpaca-provider.ts`, `new-risk-orchestrator.ts`, and a repo-wide search for
any real captured Alpaca payload.

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

## Exact Codex verification request

1. **First, no new Alpaca call needed**: for the 2026-09-21 session (or any
   session once Aiven writes are readable again), run a breakdown of
   persisted `CONTRACT_NOT_EXECUTABLE` shadow rows grouped by their
   `reasons[].detail` string. This alone will show whether "quote
   unavailable"/"quote age unknown" (unquoted contracts) or "multiplier
   unverified" or something else entirely (stale quote, crossed BBO, spread
   too wide) actually dominates the 3,299 count.
2. **Separately**, pull one live `/v2/options/contracts` page during a
   healthy (non-degraded) session and confirm `size` presence/type for a
   known-liquid ATM contract vs. a far-OTM/far-dated one, to settle whether
   "multiplier unverified" is a meaningful fraction at all, independent of
   step 1's finding.

Do not close this out as resolved until step 1's real breakdown is examined
-- a plausible-sounding theory (multiplier mapping) must not be promoted to
a confirmed root cause without it.
