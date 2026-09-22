# THETA Claude Research Harvest, 2026-09-22

## Immutable inputs

- Canonical source before harvest: `2028bfad09492424f91b579be74ffee1a8a93c39`
- Claude source: `origin/claude/theta-management-challenger`
- Integration merge: `ff39f9a20098f2bd87e4c74660b73d18234992bb`
- Claude/main divergence at review start: 124 Claude-only commits and 15 main-only commits

## Uncommitted-work protection

The Claude worktree was clean. The reported interrupted file
`src/research/loss-roll-experiment.ts` was absent from both the worktree and the
remote branch. No dirty file, patch, or stash existed to preserve.

`CLAUDE_DIRTY_WORK_FOUND = NO`

`CLAUDE_DIRTY_WORK_PRESERVED = NOT_APPLICABLE`

The missing experiment remains explicit follow-up engineering. Its absence is
not represented as harvested or complete.

## Merge classification

The branch was merged in one auditable integration merge because individually
replaying 124 interdependent research commits would discard branch history and
increase reconstruction risk. Authority was classified separately from source
integration.

| Area | Files | Classification | Runtime authority |
|---|---:|---|---|
| `src/research` | 42 | RESEARCH_ONLY | false |
| tests | 42 | ACCEPT_TEST_COVERAGE | none |
| docs | 61 | REFERENCE_AND_GOVERNANCE | none |
| Python quant modules | 5 | RESEARCH_ONLY | false |
| Python quant tests | 5 | ACCEPT_TEST_COVERAGE | none |
| tools | 2 | OFFLINE_RESEARCH | false |
| research board | 1 | GOVERNANCE | none |

Total changed files: 158.

No harvested file was added under `src/theta` or `src/providers`. No broker
mutation path, Paper authorization flag, execution gate, follower authority, or
live-money authority changed in the merge.

## Authority result

- Production decision authority remains the canonical TypeScript runtime.
- Pipeline B remains quarantined.
- Harvested research modules have `brokerAuthority = false` by policy and do not
  gain Paper authority merely by being present on the canonical branch.
- Hold-Strike and Defined Risk remain shadow/research only.
- The merge does not unlock master Paper execution, follower execution, or live
  money.

## Verification

- Node: 1,975 tests, 1,962 passed, 13 skipped, 0 failed.
- Python quant: 607 passed and 5 subtests passed.
- TypeScript check: PASS.
- ESLint: PASS.
- Build: PASS.
- Secret scan: 1,181 paths, 0 findings.

## Remaining harvested-work follow-up

1. Implement and test the missing loss/roll experiment using the accepted
   loss-cause taxonomy and a common future horizon.
2. Implement the recovery/covered-call experiment.
3. Connect accepted research datasets to immutable canonical exports. This is
   an offline evidence flow and does not grant broker authority.
4. Keep empirical profitability and policy promotion unavailable until real
   independent Paper outcomes satisfy the registered evidence requirements.
