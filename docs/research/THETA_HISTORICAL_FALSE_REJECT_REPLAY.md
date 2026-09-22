# THETA historical false-reject replay (Wave 12 Batch 4)

## What this pass actually did

Built and tested `src/research/historical-false-reject-analyzer.ts`
(commit this pass) -- real code, not a prose-only report, per the
directive's explicit instruction. It reuses Codex's own canonicalized
reason-code vocabulary (`optionExecutabilityCauses` from
`option-executability-diagnostics.ts`) rather than inventing a parallel
taxonomy, and never estimates a fill, a future quote, or a future event
observation -- every ambiguous case resolves to `NOT_RE_EVALUATED` /
`NOT_IDENTIFIABLE`, never a guess.

## What this pass did NOT do, and why

**Sep-16/18/21 were not actually replayed against real persisted PIT
evidence this pass.** This research branch (a git worktree, no database
connection configured in this session) does not have live access to the
Aiven Postgres instance holding the real persisted candidate rows,
quotes, and AEGIS assessments those three sessions produced. Running the
analyzer against real data requires either (a) a database connection
this research environment does not have configured, or (b) Codex
exporting the relevant rows to a file this branch can read.

**Fabricating a replay result without that access would violate this
engagement's own standing rule** (`never estimate a fill/quote/outcome
that wasn't observed) applied one level up: producing "Sep 21 replay
results" without ever touching the real Sep 21 rows would be exactly the
kind of confident-but-ungrounded output this whole engagement exists to
prevent.

## What IS real and available: the already-published Sep 21 funnel

The one thing this pass can honestly state is the same real,
already-published Sep 21 breakdown this engagement has cited repeatedly
(3,876 candidates; `docs/operations/THETA_R7_LIVE_SESSION_FORENSIC_2026-09-21.md`
and Codex's own closure receipts):

```
3,299  CONTRACT_NOT_EXECUTABLE
  2,014 stale quote + wide spread
    787 wide spread only
    498 stale quote only
  416  DELTA_OUTSIDE_ALL_BANDS
   53  OPEN_INTEREST_BELOW_FLOOR
   48  OWNERSHIP_ACCEPTABILITY_UNKNOWN
   39  UNKNOWN_DELTA
   20  VOLUME_BELOW_FLOOR
    1  BROKER_QTY_ZERO
```

Plus Codex's newly-measured quote-age distribution: **p50 = 101 seconds,
p90 = 2,664 seconds** at decision time. Per this wave's own explicit
instruction, this proves **age at decision**, not **provider-late vs.
pipeline-induced-delay** -- that distinction requires stage timestamps
(provider-receive vs. THETA-processing) that do not yet exist in the
persisted evidence. This pass does not claim pipeline-induced staleness;
neither confirmed nor ruled out.

## What a real replay run requires (exact, for whoever runs it)

1. **Data access**: either a database connection to the real Aiven
   instance (Codex-owned) from wherever this analyzer runs, or an export
   of the relevant `contractCandidates`/`optionomics` /AEGIS-assessment
   rows for the three sessions.
2. **Per-candidate re-derivation**: for each of the ~3,876+ Sep-21 rows
   (and the Sep-16/Sep-18 equivalents, sizes not yet known to this pass),
   construct a `CurrentReEvaluationEvidence` object from the REAL
   persisted PIT quote/Greek/liquidity/AEGIS/sizing data for that exact
   `asOf` -- never a live re-fetch, which would leak future information.
3. **Run**: `assessFalseReject(record, evidence)` per candidate, then
   `aggregateFalseRejectDay(date, assessments)` per session.
4. **Report**: the aggregate's real counts
   (`structurallyRejected`/`executionRejected`/`eventRejected`/
   `aegisRejected`/`sizingRejected`/`implementationCausedReject`/
   `insufficientEvidence`/`newlyEligibleUnderCurrentCode`), broken out
   per session, cross-referenced against the known Sep-21 funnel above as
   a sanity check (the analyzer's `executionRejected` count for Sep 21
   should be close to 3,299 if the re-derivation is faithful -- a real,
   checkable consistency test for whoever runs this).

## Codex handoff

Added to `THETA_CODEX_INTEGRATION_QUEUE.md` as Q-10: provide this
research branch (or a designated runner) either read access to the
relevant persisted evidence tables, or a one-time export of the Sep-16/
Sep-18/Sep-21 candidate+quote+AEGIS rows, so `historical-false-reject-analyzer.ts`
can be run for real rather than staying unexecuted tooling.

**Status: TOOLING_READY, DATA_ACCESS_PENDING.** This is not
`AWAITING_CANONICAL_EXPORT` in the export-consumer sense (a different,
later batch of this wave) -- it is a simpler, one-time data-access
request for a research analysis, not a permanent export contract.
