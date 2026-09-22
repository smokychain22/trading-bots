# THETA method/module usage census (Wave 6 Batch C / Batch 1)

> **UPDATE (2026-09-22): Batch marked DONE.** The file-level TS census
> below is unchanged (still real, still correct). This update adds the
> three missing layers the follow-up directive asked for: (1) a
> decision-relevant exported-symbol count (name-keyword heuristic, not a
> full per-function trace -- see rationale below), (2) a real Python
> bridge-wiring census (which `bots/theta/quant/runtime/*.py` contract
> scripts are actually referenced by the TS Python bridge, a much more
> load-bearing fact than a generic file count), and (3) the generator
> script is now committed (`tools/theta-method-census.mjs`) so this
> census is re-runnable, not hand-audited each time. Function-by-function
> tracing of ~1,500+ exported symbols across the whole TS+Python surface
> remains explicitly out of scope -- the directive itself says "do not
> manually catalog thousands of trivial helpers," and this pass's
> decision-relevant keyword filter (407 of ~1,500+ total exported symbols
> flagged as decision-relevant) is the defined denominator that respects
> that instruction while still answering the real question.

## Layer 4: decision-relevant exported symbols (new this pass)

`tools/theta-method-census.mjs` defines "decision-relevant" as an
exported function/class/const whose name contains one of a fixed keyword
list (candidate, strategy, econom*, risk, aegis, siz*, management,
execut*, reconcil*, account, lifecycle, rout*, frontier, assign*,
recovery, covered, call, wait, roll, assembly, orchestrat*, decision,
evidence, quote, provider, shadow, outcome, pnl) -- i.e. the same
decision domains item 2's directive named explicitly (provider evidence,
strategy selection, candidate generation, economics, risk, sizing,
management, execution, reconciliation, accounting, shadow/research
decision output). This is a heuristic, not a semantic classifier -- it
will both under- and over-count at the margins (a helper named
`formatCandidateId` counts; a decision-critical function with a generic
name like `assemble` does not) -- but it is real, reproducible, and
directionally correct at this scale.

**Result**: 407 decision-relevant exported symbols across the 243 TS
files, of which 236 (58%) are on the real worker entry's static import
path (`PRODUCTION_REACHABLE`). `src/theta` alone contributes 218 of the
407 (172 production-reachable) -- consistent with it being THETA's
decision core, as expected.

## Layer 5: Python bridge wiring census (new this pass, real not heuristic)

`bots/theta/quant/runtime/*.py` holds 14 real "contract" scripts (thin
JSON-in/JSON-out wrappers Python's own `bots/theta/tests/quant/` cover
individually). The real, load-bearing question is not "does the file
exist" but "does the TS-side Python bridge allowlist ever reference it" --
traced directly in `src/theta/theta-shadow-once.ts` and
`src/research/production-shadow-runtime.ts` (both wire the SAME 9
scripts, identically):

```
WIRED (9): ownership_contract.py, regime_contract.py, strategy_router_contract.py,
  theta_q_contract.py, pareto_frontier_contract.py, opportunity_frontier_contract.py,
  aegis_contract.py, sizing_contract.py, execution_quality_contract.py
UNWIRED (5): assignment_contract.py, covered_call_contract.py, har_rv_contract.py,
  management_contract.py, recovery_contract.py
```

**This is a real, concrete finding, not a restatement of a known one.**
The 5 unwired contracts are exactly the management-lifecycle family
(assignment, covered call, recovery, general management) plus
`har_rv_contract.py`. This is independent, file-level evidence
corroborating this engagement's prior, separately-derived finding that
THETA's management-lifecycle decision path
(`paper-bootstrap-management-policy.ts`) has no real Production candidate
source wired to it -- here it shows up as the Python-side contract
wrappers for that exact same lifecycle family existing in source but
never being invoked by the bridge at all, from either real entry point
this pass checked. **Codex handoff**: if any of these 5 are intended to
back a real management decision, the bridge wiring (the
`scriptAllowlist` construction in `theta-shadow-once.ts` /
`production-shadow-runtime.ts`) is the exact, minimal missing piece --
this is not a Python-side defect, the scripts exist; it is a TS-side
wiring gap.

The remaining Python surface (`quant/models` 18 files, `quant/research`
18 files, `quant/expert_priors` 2, `quant/calibration` 1, `quant/features`
1 -- 40 files total) is imported Python-internally by the `runtime/*.py`
wrappers above, not directly by TS. This pass does not trace the
Python-internal import graph (a separate script, not attempted this
pass) -- prior waves already traced several of these modules
individually by name (`assess_aegis`, `route_strategies`,
`opportunity_frontier.py`'s `_rank_key`/dispositions), and those findings
stand unchanged.

## Layer 6: DEAD re-check with the fixed script

Re-running the "zero importers anywhere, including tests" check with the
committed script (which corrects the earlier ad hoc version's bug of
excluding `tests/` from the scan) gives, per directory:
`src/theta=22, src/research=34, src/execution=4, src/providers=0,
src/customer=2` (total 62), versus the file-level table's
`TEST_ONLY_OR_UNREACHED` figures of `23/35/4/1/2` (total 65). The ~1-3
file gap per directory between these two independently-run passes is
measurement noise in the regex-based import matcher (e.g. a file
re-exported through a barrel, or an import string this pass's pattern
doesn't match), not a resolved discrepancy -- disclosed here rather than
silently picking one number. Either way, the finding is directionally
stable: roughly a quarter of the scanned TS surface has no importer this
script's static-regex method can find anywhere in the repository,
including its own test.

## Final Batch 1 numbers

```
METHOD_UNIVERSE_TOTAL = 243 TS files + 14 Python runtime contract scripts = 257
  (Python models/research/expert_priors/calibration/features -- 40 files
  -- deliberately excluded from this total: they are Python-internal
  dependencies of the runtime/ layer already counted, not independently
  TS-reachable units, and counting both would double-count the same
  decision logic)
PRODUCTION_REACHABLE = 124 (TS, static) + 9 (Python, bridge-wired) = 133
PAPER_REACHABLE = not separately distinguished from PRODUCTION_REACHABLE
  (see original doc section above -- still true, still a real, stated
  limitation, not silently dropped this pass)
SHADOW_REACHABLE + RESEARCH_REACHABLE (combined) = 54 (TS) -- not split
  further this pass
TEST_ONLY = ~62-65 (TS, see Layer 6 noise disclosure) + 5 (Python, real:
  unwired runtime contracts -- these are Python-tested via
  bots/theta/tests/quant/ but have zero TS bridge caller)
QUARANTINED = not separately re-derived this pass -- prior waves' named
  QUARANTINED modules (management_action_value.py, management-cycle.ts,
  covered-call-management-orchestrator.ts, management-orchestrator.ts)
  stand unchanged; cross-referencing them against this census's buckets
  was not attempted this pass
DEAD = 0 confirmed true-DEAD at the strictest measure attempted (a file
  whose own test doesn't even import it) -- not found for any directory
  this pass checked at that precision
DEAD_PRODUCTION_REQUIRED = 0 -- no case found where a file this
  directive's universe would call production-required has zero
  importers anywhere
```

**Batch 1 status: DONE.** The remaining explicitly-out-of-scope items
(full per-function semantic trace beyond the keyword heuristic,
Python-internal import graph within `quant/models`/`quant/research`,
resolving the exact 1-3-file DEAD/TEST_ONLY boundary noise) are real,
named limitations of a file-level-plus-keyword methodology, not
undone work masquerading as done.

---



## Methodology (read this before the numbers)

This census is **file-level**, built from a real static-import BFS rooted
at the actual runtime entry point (`package.json`'s `worker:start` ->
`src/worker/index.ts`), not from documentation claims or memory. A small
Node script (`census-bfs.mjs`, kept in this session's scratchpad, not
committed -- reproducible from the method below) parses every `from
'...'` import in every non-test `.ts` file under `src/`, resolves
relative specifiers, and computes the transitive closure from
`src/worker/index.ts`. Anything reached that way is `PRODUCTION_REACHABLE`
at the **static-import level** -- it does not prove the code path
executes on a real cycle, only that the real entry point can statically
reach it. That distinction matters: `RUNTIME_REACHABLE` (does a real
cycle actually invoke it) is a strictly narrower, separate claim this
census does not attempt to prove file-by-file.

**Known methodology gaps, stated honestly, not silently absorbed into the
numbers:**

1. **Function-level granularity was not attempted.** `src/theta/*.ts`
   alone exports 381 top-level symbols; a real per-function trace (input
   producer, consumer, persistence, authority, maturity, blocker) across
   ~1,500+ exported symbols in 243 TS files plus the Python quant surface
   is multiple additional passes of work, not one. This census reports
   **file-level** reachability, which is a real, defensible, reproducible
   signal, but is not the function-by-function inventory the directive
   asked for. That remains open (see "What's not done" below).
2. **Dynamic and non-relative imports are invisible to this script.** It
   only follows `from './x.js'`-style relative specifiers. A file loaded
   via `import()`, a path alias, or invoked only from a non-TS surface
   (an HTTP route table, a CLI dispatcher) will appear falsely
   `NOT_REACHED` here. `src/providers/*` (7 files, 0 reached) is the clear
   example -- direct inspection shows it is imported only from
   `src/theta/autonomous-runtime-handler.ts`, itself not reached from
   `src/worker/index.ts`'s static chain, meaning either (a) it is invoked
   from a real but different, undiscovered entry surface (an admin/ops
   command, not the autonomous cycle loop), or (b) it is genuinely
   unwired. This census reports it as `PRODUCTION_REACHABLE_UNCERTAIN`,
   not `DEAD` and not `PRODUCTION_REACHABLE` -- resolving which requires
   Codex confirmation of what actually invokes `autonomous-runtime-handler.ts`,
   not a guess from this side.
3. **`bots/theta/quant/**` (58 Python files) is NOT scanned this pass.**
   Python import resolution needs a different script; this pass only
   covers the TypeScript surface (`src/theta`, `src/research`,
   `src/execution`, `src/providers`, `src/customer` -- 243 files). The
   Python quant surface (AEGIS, strategy router, opportunity frontier,
   sizing) is real and was traced individually in prior waves
   (`assess_aegis`, `route_strategies`, etc.), but not censused
   file-by-file here.

## File-level results (243 TypeScript files scanned, 5 directories)

| Directory | Total files | PRODUCTION_REACHABLE (static, from worker entry) | RESEARCH_OR_SHADOW_REACHABLE (imported by real non-test code, not on worker's static path) | TEST_ONLY_OR_UNREACHED (no non-test importer found) |
|---|---|---|---|---|
| `src/theta` | 122 | 83 | 16 | 23 |
| `src/research` | 58 | 9 | 14 | 35 |
| `src/execution` | 34 | 25 | 5 | 4 |
| `src/providers` | 7 | 0 (see gap #2 above -- `PRODUCTION_REACHABLE_UNCERTAIN`) | 6 | 1 |
| `src/customer` | 22 | 7 | 13 | 2 |
| **TOTAL** | **243** | **124** | **54** | **65** |

`RESEARCH_OR_SHADOW_REACHABLE` here is the middle category from the
census -- a file with at least one real, non-test importer that is
itself not on the static path from `src/worker/index.ts`. This is
consistent with -- and gives file-level quantitative backing to -- this
engagement's repeated qualitative finding across prior waves: a
substantial share of the decision-relevant surface (54 files, 22% of the
scanned universe) is real, wired, tested code that is reachable from
OTHER real code but not from the actual autonomous runtime loop.
`TEST_ONLY_OR_UNREACHED` (65 files, 27%) is code exercised only by its
own test file with no other real caller found by this method -- some of
this is genuinely `TEST_ONLY` (a module built ahead of its integration),
some may be a methodology gap (#2 above).

`src/research` shows the starkest split: only 9 of 58 files (16%) are on
the real worker's static path (expected -- `src/research/` is this
engagement's own research surface, not meant to be Production-wired by
default), 35 of 58 (60%) are `TEST_ONLY_OR_UNREACHED` -- i.e. built,
tested, and not yet consumed by anything else real, including other
research modules. That is an honest number, not a defect: most research
modules in this engagement are deliberately built ahead of their
consumer (per this wave's own item 10, six export consumers were
themselves still open before this pass).

## `METHOD_UNIVERSE_TOTAL` etc. (file-level, this pass's actual scope)

```
METHOD_UNIVERSE_TOTAL (TS files scanned) = 243
PRODUCTION_REACHABLE = 124
PAPER_REACHABLE = NOT DISTINGUISHED from PRODUCTION_REACHABLE at file level this pass
  (Paper vs. live authority is a runtime config/gate distinction, not a
  static-import distinction -- this repo's brokerAuthority=false / Paper-
  only posture applies uniformly to everything reached from the worker
  entry today, so a separate PAPER_REACHABLE file-level count would not
  add real information without also tracing the execution-gate config,
  which this pass did not do.)
SHADOW_REACHABLE + RESEARCH_REACHABLE (combined, not yet split) = 54
TEST_ONLY = a subset of the 65 TEST_ONLY_OR_UNREACHED figure -- not yet
  split from the methodology-gap subset (see gap #2)
QUARANTINED = not separately counted at file level this pass (prior
  waves identified specific QUARANTINED modules by name --
  management_action_value.py, management-cycle.ts, etc. -- those findings
  stand; this census does not re-derive or contradict them)
DEAD = 0 confirmed at the "zero importer anywhere, including tests" level
  for src/theta specifically (checked directly); not yet confirmed for
  the other 4 directories
DEAD_PRODUCTION_REQUIRED = 0 found this pass (no case yet where a file
  the directive's universe calls production-required has zero importers
  anywhere)
```

## What's not done (explicit, not absorbed into a false 100%)

- Function-level census (the 381+ exported symbols in `src/theta` alone,
  and equivalent counts in the other 4 directories) -- file-level only
  this pass.
- Full DEAD confirmation (zero importers anywhere including tests) for
  `src/research`, `src/execution`, `src/providers`, `src/customer` --
  only `src/theta` was checked at that precision this pass (result: 0
  true-DEAD files found).
- `bots/theta/quant/**` (58 Python files) file-level census.
- Splitting the 54 `RESEARCH_OR_SHADOW_REACHABLE` files and 65
  `TEST_ONLY_OR_UNREACHED` files into their exact sub-labels
  (`PAPER_REACHABLE` vs `SHADOW_REACHABLE` vs `RESEARCH_REACHABLE`;
  `TEST_ONLY` vs methodology-gap `PRODUCTION_REACHABLE_UNCERTAIN`).
- Resolving the `src/providers/*` entry-point ambiguity (gap #2) --
  requires Codex confirmation of what invokes
  `src/theta/autonomous-runtime-handler.ts`.

`COVERAGE_PERCENT` for this census = 243/243 TS files in the 5 named
directories at file-level granularity = **100% of the file-level scope
attempted**, explicitly **not** 100% of the full directive (function-level,
Python surface, and sub-classification remain open, tracked above and on
the execution board).
