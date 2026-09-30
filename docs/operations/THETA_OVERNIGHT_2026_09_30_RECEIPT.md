# THETA overnight 2026-09-30 reality receipt

This receipt distinguishes observed runtime facts from branch source changes.
It is not a Paper authorization or an empirical profitability claim.
The machine-readable dated register is
`docs/operations/THETA_CURRENT_BLOCKER_REGISTER.json`.

```json
{
  "receiptVersion": "theta-overnight-2026-09-30-v1",
  "baselineMain": "c3317698d34de275a96957e91177095bfdcab406",
  "sourceBranch": "codex/theta-overnight-20260930",
  "workerReleaseAtAudit": "c3317698d34de275a96957e91177095bfdcab406",
  "workerArchitecture": "one resident PowerShell supervisor invoking the Node/Vercel runtime",
  "workerHealthAtAudit": "STALE_HEARTBEAT",
  "productionDatabase": "SQLSTATE_53000_RESOURCE_LIMIT",
  "currentReleaseSupportedSessionProof": "NOT_OBSERVED",
  "firstPaperOperationalReadiness": "NOT_PROVEN",
  "readyForFirstPaper": false,
  "orderSubmissionsByThisWave": 0,
  "brokerMutationsByThisWave": 0,
  "masterExecution": "LOCKED",
  "followerExecution": "LOCKED",
  "liveMoney": "NOT_AUTHORIZED"
}
```

## Observed runtime and data

- The worker status command reported one supervisor, a stale heartbeat and a
  Command-5A schedule timeout, research-export timeout and archive failure.
  A stale health record cannot certify a healthy renewing lease or DB circuit.
- Two bounded, explicit `.env.local` read-only PostgreSQL checks returned
  SQLSTATE `53000`. No further Production database polling or new no-submit
  attempt was justified in this window. This is an infrastructure blocker,
  not a strategy WAIT.
- Local read-only Command-5A SQLite inspection found 1,904 jobs, including
  1,456 pending, 400 missed and 48 censored. 266 jobs were already overdue.
  No job had reached `OBSERVED`. Later spot snapshots cannot reconstruct exact
  missed 15-minute or one-hour marks as `MARKET_OBSERVED`.
- A local bounded scheduler diagnostic completed one frontier in about 8.7
  seconds and eight frontiers in about 25 seconds. The resident command used a
  250-frontier page under a 180-second deadline. This is a measured source
  scaling defect. It does not prove the exact stage of the older timed-out
  child, whose output was not preserved.
- An existing `--latest` research manifest covered Sep 14-15 and held 7,550
  candidate rows in a 115.8 MB JSON file. The source queried the entire
  accumulated history for `--latest`, so worker-cycle cost grew with history.
- The local research SQLite file was about 650 MB. A single archived payload
  JSON measured about 340 MB. The worker previously verified all historical
  spool payload hashes each cycle. Full-history verification remains a
  separate certification operation. No evidence was deleted.

## Source changes pending release certification

1. Bound each worker Command-5A schedule call to eight frontiers and each
   archive call to one frontier. The archive report explicitly says historical
   spool integrity was not rechecked in that worker pass and verifies each new
   batch by hash.
2. Make `--latest` export one UTC decision day. Preserve a typed, sanitized
   failure code for PostgreSQL resource limit, DNS, network and known failures.
3. Open the observation-job SQLite store read-only for health queries and
   classify SQLite busy/corrupt and PostgreSQL failures without raw payloads.
4. Preserve each assessed finalist's AEGIS family result in future immutable
   cycle archives. Past archives are unchanged.
5. Remove Optionomics research qualification from first-Paper executable
   quote clearance. Require a current Alpaca Paper provider capability or
   qualified Alpaca Paper quote receipt. A separate pure readiness receipt
   rejects a non-Alpaca bid/ask source.
6. Expose a read-only pre-authorization projection separating owner locks from
   other blockers. This projection cannot enable execution.

No source change in this branch has been deployed to the resident worker as
of this receipt's initial creation. A supported-session current-release run,
exact four-finalist AEGIS family matrix, finalist refresh, sizing cascade and
real Paper plan remain unproven in the current worker.

Local validation before release: 3,071 Node tests, 3,056 passed and 15
intentionally skipped, 1,234 Python tests plus 25 subtests passed, 23 browser
tests passed, and TypeScript check, lint, build, security scan and Git storage
policy passed. The final narrow quote-source and archive regression tests also
passed after the broad suite. These are source-level results, not a deployed
runtime certificate.

## First-Paper authority and blocker matrix

| Item | Current classification | Exact next evidence |
| --- | --- | --- |
| Aiven admission | `EXTERNAL_PROVIDER_BLOCKED` | Bounded successful read and application-write proof after quota restoration. |
| Worker health | `RUNTIME_UNVERIFIED` | Fresh heartbeat, renewing lease, exact source SHA and successful durable cycle after controlled cutover. |
| Command-5A missed marks | `FORWARD_DATA_REQUIRED` | Fresh, on-time future GET observations. Historical misses stay missed. |
| Current-release four-finalist AEGIS reasons | `RUNTIME_UNVERIFIED` | Decode a future current-release archive with per-candidate family results. |
| Event/corporate-action current clearance | `PROVIDER_OR_RUNTIME_UNVERIFIED` | Complete time-bounded current provider evidence and negative assurance where supported. |
| Exact Alpaca executable BBO | `RUNTIME_UNVERIFIED` | Current-session exact contract quote source, timestamps, spread and refresh. |
| Current account, broker capacity and sizing | `RUNTIME_UNVERIFIED` | Fresh broker reconciliation plus candidate-bound sizing waterfall. |
| Empirical EV, POP and profitability | `EMPIRICALLY_UNPROVEN` | Resolved independent Paper whole-chain outcomes, PIT-safe OOS evaluation. |
| First Paper submission | `OWNER_PERMISSION_REQUIRED` | Separate bounded owner authorization after operational readiness. |

The static V20 provider-limited statement is historical certification
context, not a current provider read or first-Paper authorization. The pure
first-Paper readiness and dry-run builders still require explicit evidence
input. No current-runtime preauthorization builder is claimed here.

`ORDER_SUBMISSIONS=0`, `BROKER_MUTATIONS=0`, `FOLLOWER_SUBMISSIONS=0`,
`MASTER_PAPER_EXECUTION_ENABLED=false`,
`FOLLOWER_PAPER_EXECUTION_ENABLED=false`, `PAPER_PAUSE_NEW_ORDERS=true`,
`LIVE_AUTHORIZATION=NOT_GRANTED`, `READY_FOR_FIRST_PAPER=NO`.

## Later locked-runtime update, 04:23 UTC

Exact main `36adb6404d02d6008450680bfe8df87f0eb7d369` passed CI run
`36657634840`. A governed immutable locked cutover replaced the old c331
supervisor. The old supervisor was asked to stop, then its exact identified
noncritical archive child was terminated after the task stopped. SQLite
`PRAGMA quick_check` returned `ok`. The installer produced one c331 successor
only, at `36adb64`, with one resident PowerShell supervisor. A read-only DB
check saw schema 067, read-only `off`, one active worker lease and 16 total
connections. The new worker had a fresh heartbeat and a closed-session cycle.
The pre-cutover read-only broker reconciliation was GOOD, with zero positions,
zero open orders, zero entry-blocking broker facts and 11 historical
accounting-only facts. No order was submitted.

The new release exposed one real noncritical wiring defect: the Command-5A
health subprocess used the release checkout's absent `.env.local` instead of
the explicit Production environment file. A direct local health invocation
with the correct file succeeded and read 1,904 jobs. Source now avoids loading
the provider environment for local-only health and maturation, with a
deterministic missing-dotenv regression. This correction is not in the
installed `36adb64` release. The one governed premarket cutover has already
been consumed, so this noncritical health correction must wait for the next
safe release. No supported-session current-release candidate or AEGIS proof
has occurred.
