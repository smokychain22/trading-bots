# THETA method/module usage census (Wave 6 Batch C)

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
