# THETA zero-additional-cost research Actions

Status: local source proposal only. This workflow has not been pushed, merged,
enabled, dispatched, or scheduled remotely.

## Boundary

The workflow is research-only. It cannot submit orders, read an Alpaca account,
load DATABASE_URL, change strategy authority, or call a production endpoint. It
does not run theta:shadow:once or export-historical-replay. It uses one literal
ubuntu-24.04 standard public runner, one job, a 12-minute job timeout, an
8-minute pipeline step, explicit concurrency, contents:read, no action cache,
and no artifact upload.

GitHub documents standard hosted-runner compute as free for public
repositories. Artifact and Packages storage is a separate billing boundary.
This workflow stores only the ordinary job log and summary; it does not upload
research data. The existing CI workflow still runs on branch pushes and does
upload 14-day artifacts, so a remote branch push is not yet certified as
zero-additional-storage-cost. Before publication, verify available quota and
spend blocking or obtain approval for a narrowly reviewed no-storage CI path.
Do not silently bypass existing CI.

## Default-off activation

The job is skipped before runner assignment unless all of these are true:

- the repository is smokychain22/trading-bots and public;
- the ref is the default branch;
- repository variable THETA_RESEARCH_ACTIONS_ENABLED is exactly true; and
- the checked-in workflow and configs have passed review.

Creating the variable, publishing the workflow, or merging it is a separate
owner/governance action. The source proposal does none of those things.

## Cadence and calendar

The schedule uses current GitHub IANA timezone syntax:

- 10:17, 13:17, and 15:17 America/New_York on weekdays for bounded shadow
  observations;
- 17:23 on weekdays for an after-close report; and
- 11:43 Saturday for offline research.

The gate rechecks actual America/New_York time against the official Cboe U.S.
options calendar. Holidays, late shadow starts, starts after an early close,
and dates outside the verified calendar range skip. Scheduled Actions remain
best effort and are never a critical execution service.

Calendar source: https://www.cboe.com/about/hours/us-options/

GitHub schedule source:
https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule

## Evidence contract

The default evidence manifest is deliberately empty and public-safe. Its first
truthful result is:

- SOURCE_GAP for reviewed real-evidence-to-domain adapters; the pure
  deterministic contract composition is implemented, but a generic admitted
  ObservationBundle is not silently treated as a domain-ready market record;
- DATA_GAP;
- HISTORICAL_REPLAY_NOT_RUN;
- EMPIRICAL_GAP; and
- PAPER_AUTHORITY_GAP.

The orchestrator reuses ObservationBundle and runRealDataArrivalPipeline for
manifested repository-local evidence. It preserves source hashes, PIT
validation, and the UNKNOWN audit. Input is capped at 32 MiB total, 16 MiB per
file, five symbols, 20,000 rows, 200 complete episodes, 12 preregistered
comparisons, and 500 resamples. Reaching a cap is disclosed and never means
the sample is adequate.

The checked-in deterministic scenario invokes the existing five-axis regime
parser, Q/D paired study, H short-DTE versus Conventional pairing, all 17
entry/exit policies, and Recovery/Covered-Call experiment. The adapter first
enforces an identical Q/D primary short-leg identity and expiration, then
delegates to the existing shared-expiration contract. It preserves H at 2-5
DTE with no roll and Conventional at 25-60 DTE, and delegates A/C
common-horizon and stage-valid-action checks to the existing experiment
contract. The four contract-composition comparisons count against the
12-comparison cap and are always reported as non-empirical
DETERMINISTIC_SCENARIO_COMPARISON evidence. The public adapter exposes no
winner, return estimate, recommendation, actual fill, or broker authority.

INDICATIVE option quotes may support explicitly labeled diagnostics. They
cannot certify OPRA execution-quality replay even when a fixture says
executable=true and dataQuality=GOOD. OPRA replay additionally requires
verified historical BBO coverage and entitlement. A missing paired protective
leg or complete exit path remains a named gap.

Fixtures must be labeled SYNTHETIC_TEST or
DETERMINISTIC_SCENARIO_COMPARISON. They are never described as market
backtests or broker fills.

## Existing source reused

The policy inventory checks the existing dataset CLI and arrival harness,
canonical strategy frontier, regime contracts, Q/D paired-study economics,
H cohort and no-roll lifecycle, profit-taking and defined-risk replays,
Recovery/Covered-Call experiments and cohorts, and common-horizon utility.
The workflow does not build a second broker engine or a duplicate replay.

Current source rules remain:

- Q / Conventional: 25 to 60 DTE;
- H / Hold Strike: 2 to 5 DTE, with no roll action;
- D / Defined Risk: 7 to 60 DTE; and
- C / Covered Call: 1 to 60 DTE.

Q/D identical-short-leg and same-risk-budget experiments remain separate. The
deterministic primary adapter now enforces identical short-leg identity before
calling existing paired-study Cohort A, which enforces shared expiration. This
closes the narrow source-composition gap only; it is not an empirical Q/D
result. The same-risk-budget and historical-outcome experiments remain gaps.
The regime fixture validates the five independent axes without invoking or
duplicating the Python model. The H fixture stays unresolved, pairs only on the
same snapshot/timestamp/evidence class/underlying, and cannot create an
empirical cohort result. The entry/exit fixture executes existing policies
offline with actualFill=false and EMPIRICALLY_UNPROVEN.
Recovery/Covered-Call historical basis remains separate from forward value,
and the deterministic A/C adapter exercises only stage-valid actions. Real
historical A/C outcomes remain a DATA_GAP/EMPIRICAL_GAP.

## Review and activation checklist

1. Reverify all pinned action SHAs against the official action repositories.
2. Extend the official options calendar before its valid-through date.
3. Review any non-empty evidence manifest and its immutable hashes.
4. Verify workflow-file publication permission and repository Actions
   enablement without making a test write.
5. Resolve the existing CI artifact-storage side effect.
6. Obtain the charter-required owner instruction before any push.
7. Set the activation variable only after publication review.

No step in this document grants Paper or Production authority.
