# THETA canonical strategy/method census (COMMAND 3, read-only)

Re-run of the already-committed, reproducible `tools/theta-method-census.mjs`
against this branch's current working-tree state (merged through main
`61f2108` plus this branch's own commits -- **not** merged through the
~250 additional main commits COMMAND 1's audit read via `git show`
without merging, since these COMMAND-sequence items are deliberately
read-only and do not disturb the working tree mid-audit). A fully
current census against main `e2d9fdc` would require a real merge first;
not done here to stay read-only per this command's own instruction.

## Delta vs. the last full census (Wave 6/9, `THETA_METHOD_USAGE_CENSUS.md`)

| Directory | Then (files) | Now (files) | Then (production) | Now (production) |
|---|---|---|---|---|
| `src/theta` | 122 | 127 | 83 | 87 |
| `src/research` | 58 | 72 | 9 | 9 |
| `src/execution` | 34 | 34 | 25 | 25 |
| `src/providers` | 7 | 7 | 0 | 0 |
| `src/customer` | 22 | 22 | 7 | 7 |
| **TOTAL** | **243** | **262** | **124** | **128** |

Decision-relevant exported symbols (keyword heuristic, unchanged
methodology): 407 -> 431 total, 236 -> 243 production-reachable.

**Growth is concentrated in `src/theta` (+5 files, +4 production-reachable)
and `src/research` (+14 files, still only 9 production-reachable)** --
consistent with COMMAND 1's finding that recent main work is mostly
evidence-certification/calibration/dataset infrastructure (research-
adjacent, not new entry-candidate authority) plus the 2 real AEGIS
producer files.

## Python bridge wiring -- unchanged, still 9/14

Identical to the last check: `assignment_contract.py`,
`covered_call_contract.py`, `har_rv_contract.py`, `management_contract.py`,
`recovery_contract.py` remain unwired -- matches the standing
`THETA_PYTHON_RUNTIME_CONTRACT_DISPOSITION_RESEARCH.md` finding
(4 QUARANTINED/Pipeline-B, 1 SUPERSEDED_BY_TS_AUTHORITY). No change in
disposition; not re-investigated.

## Read-only, no cleanup performed

Per this command's explicit instruction, no files were modified, moved,
or deleted. If cleanup of `TEST_ONLY`/dead-static files is wanted,
that requires explicit authorization (a separate command), and even then
should stay in Claude's isolated branch, never touching files Codex is
actively working in (crosschecked against COMMAND 1's finding that main's
recent work concentrated in AEGIS/database-resilience/calibration areas,
distinct from most of the `TEST_ONLY`-classified research files here).
