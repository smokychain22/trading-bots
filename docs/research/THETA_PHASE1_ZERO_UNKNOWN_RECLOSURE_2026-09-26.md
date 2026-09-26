# THETA Phase 1 — Zero-Unknown Reclosure (2026-09-26)

The owner reopened Phase 1 specifically to resolve `THETA-BRAIN-L7-CALLER-GAP`,
which prior passes had treated as acceptable "cross-phase" residue. This pass
resolves it with a real, exact worker-to-brain trace and a real, tested,
wired caller — not by moving it to another phase, and not by relabeling it
without evidence.

## The real worker → canonical brain trace (exact files/functions, not conceptual)

1. Scheduled Task runs `tools/windows/theta-local-worker.ps1` (a thin
   PowerShell REST client).
2. It POSTs to the deployed Vercel endpoint with
   `X-Theta-Operation: runtime-evidence-cycle` (and siblings).
3. The Vercel route (`api/theta-runtime.ts`) invokes
   `autonomousRuntimeHandler` (`src/theta/autonomous-runtime-handler.ts:138`),
   which parses the operation header
   (`parseLocalWorkerOperation`) and calls
   `runAutonomousRuntimeCycle(environment, runtimePool, new Date(), {scope})`
   (`autonomous-runtime.ts:845`).
4. For the `OPPORTUNITY_SCAN`/`WAIT_RECHECK` job types, that cycle calls
   `runProductionShadowEvidenceScan(...)` (`production-shadow-runtime.ts:245`),
   which (line 358) calls **`runThetaShadowCycle(...)`**
   (`theta-shadow-cycle.ts:691`) — the canonical brain entrypoint.
5. `runThetaShadowCycle` builds `strategyFrontier` via
   `buildCanonicalStrategyFrontier` (`canonical-strategy-frontier.ts`) and the
   subordinate receipt via `new-risk-orchestrator.ts`, then
   `resolveCanonicalDecisionAuthority` (`canonical-decision-authority.ts`)
   resolves the sole, final selection — confirmed (Phase 4) to be the only
   quantity/action authority consumed downstream
   (`master-paper-plan-assembly.ts:59` reads `frontier.selectedCandidateId`
   directly, never a subordinate-receipt field).

**Every step above is a real file:line citation, verified by direct read
this pass, not a diagram.**

## The fallback path uses the SAME brain (no legacy/parallel decision logic)

When the primary path can't reach Postgres, `theta-local-worker.ps1`'s own
outer catch runs `tools/theta-no-submit-probe.ts`. That script (line 9, 16)
imports `runProductionShadowEvidenceScan` **and**
`runDatabaseIndependentShadowObservation` — the latter
(`database-independent-shadow-observation.ts:168`) wires
`runCycle: runThetaShadowCycle` directly. **This is the exact script that
produced the real Sep24 evidence** recovered in Phase 2: its
`spoolEvidence('Q_READY', {symbol, qCandidateCount, qDecision, qReasonCodes,
qCandidates, frontierCandidates, blockers, ...})` call (line 196) matches,
field-for-field, the real persisted Sep24 `Q_READY` payload
(`branch: 'THETA_CONVENTIONAL'`, `aegisFamilies`, `family.reasonCodes`) —
independent confirmation, from two directions (source trace + real
historical data), that both the primary and fallback paths invoke the exact
same canonical brain function. **No parallel/legacy brain exists on either
path** — searched explicitly for a second selector/orchestrator/action
planner; none found, and the one real candidate
(`resolveCanonicalDecisionAuthority`) has exactly the 3 real callers
(itself, `postgres-theta-cycle-store.ts`, `profitability-brain-reality.ts`),
none of which bypass it.

## Offline real-evidence replay tool — already exists, re-confirmed real

`src/theta/theta-shadow-once.ts` (`npm`-runnable, `--allow-manual-inputs`
dev-only) is exactly the "offline Monday certification" tool item 24 asks
for: it calls the same `runThetaShadowCycle`, never an order endpoint
(verified: the only `/v2/orders` reference in the whole provider layer is a
read-only `fetchOpenOrders` GET), and already printed
`decisionAuthorityVersion: result.strategyFrontier?.decisionAuthorityVersion`
in its output before this pass — i.e. **brain-version-in-receipt (item 14)
was already real** for this command. This pass did not need to build this
tool; it needed a real L7-evidence caller, which is what was actually
missing (see below).

**Not run live this pass**: this tool requires real Alpaca credentials,
which are not reachable from this session (re-confirmed, `env | grep -i
alpaca` empty, no Alpaca-capable tool available) — the same
`CREDENTIAL_UNAVAILABLE` finding as Phase 4. This is an honest external
limitation on *this session*, not a source gap: the tool itself, the
canonical-brain wiring, and (new this pass) the reality-evidence wiring are
all real and tested.

## THETA-BRAIN-L7-CALLER-GAP — resolved, source-level

The gap was never that `buildProfitabilityBrainRealityReceipt` couldn't
express L7 (`currentWorkerRealData`) — it always accepted a real evidence
list as input. **The gap was that no production caller ever derived and
supplied that list.** Fixed:

- New `deriveRealCurrentWorkerEvidence()` (`profitability-brain-reality.ts`):
  a pure, evidence-conservative function that inspects an ACTUAL
  `ThetaShadowCycleResult`-shaped object (a minimal structural `Pick`, no
  circular import) and returns only methodIds it can positively justify
  from real, present fields (an evaluated `THETA_CONVENTIONAL` branch →
  `CONVENTIONAL_CANDIDATE_ENUMERATION`; a candidate with a real
  `aegisState` → `AEGIS_RISK_PERMISSION`; etc.) — never from an absence,
  and defensively filtered against the real registry so it can never
  invent an unregistered methodId by typo.
- Wired into `theta-shadow-once.ts`: every genuine run now derives its own
  evidence from *that run's own real output* and calls
  `buildProfitabilityBrainRealityReceipt({ currentWorkerRealData: ... })`,
  printing `brainRealityEvidenceThisRun`/`brainRealityLevelCounts` — never
  a fixture, never a hand-typed list.
- 3 new tests, using a fixture shaped exactly like the real, recovered
  Sep24 evidence (an evaluated `THETA_CONVENTIONAL` branch with a real
  `aegisState`/`sizing.quantity`, four other branches genuinely
  unevaluated): proves the derivation correctly promotes the methods that
  really ran and — critically — never over-claims for branches that did
  not run (`RECOVERY_CANDIDATE_ENUMERATION` stays at its base
  `L6_RUNTIME_REACHABLE` level in that fixture, exactly as it should).

**Honest status**: `SOURCE_BUILT` + `WIRED` + tested this pass.
`REAL_DATA_VERIFIED` (an actual live/replay run producing a genuine L7
receipt) remains pending real Alpaca access in a future session — this is
the one honest remaining item, and it is external (credentials), not a
code gap. The mechanism itself is proven correct against a real-evidence-
shaped fixture, not merely a synthetic one.

## False/cosmetic capability check (items 18-20)

Re-checked `resolveCanonicalDecisionAuthority`'s consumer set (3 files,
none bypassing it) and `master-paper-plan-assembly.ts`'s direct read of
`frontier.selectedCandidateId` — both already real, not cosmetic. Did not
find a second `TRUE`/`READY`-labeled capability with a missing consumer
this pass beyond what Phases 2-4 already found and fixed (Q-lattice
absence semantics, cost-model structured fields, sizing-authority naming).

## Not resolved this pass (honest, scoped)

- **Source SHA in the persisted decision row**: `decisionAuthorityVersion`,
  `strategyVersion`, and `contractVersion` are all genuinely persisted
  (`postgres-theta-cycle-store.ts:605-703`, and the decision ID itself is
  deterministically derived *including* `decisionAuthorityVersion`) — but
  a literal git commit SHA is not a separate persisted field. This is a
  minor, safe, additive enhancement opportunity, not implemented this pass
  to avoid a rushed persistence-layer schema change; the existing version
  fields already answer "which brain produced this" for practical
  purposes.
- **Live current-worker proof**: genuinely blocked on credentials this
  session, as stated above.

## Verification

`tsc --noEmit`: clean. `eslint`: clean. Full Node suite: 2822 tests, 2808
pass, 14 pre-existing DB skips, 0 fail. Full Python suite unchanged (697
passed + 11 subtests, Python untouched this pass). No orphan processes.

## PHASE_1_STATUS = CLOSED

`THETA-BRAIN-L7-CALLER-GAP` is resolved at the source level: the real
worker→brain call chain is traced exactly, the fallback path is confirmed
to use the identical canonical brain (not a parallel one), the offline
replay/certification tool is confirmed real and already receipt-versioned,
and the missing L7-evidence caller is now built, wired, and tested against
a real-evidence-shaped fixture. The one remaining item
(`REAL_DATA_VERIFIED` via an actual live run) is an external credential
blocker for this session, not a code-solvable gap left unresolved — stated
precisely rather than hidden behind a generic "cross-phase" label.
