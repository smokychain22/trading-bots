# Current Engineering Handoff

**Last updated:** 2026-09-10, end of this Claude takeover session (continuation pass).
**Origin/main SHA at session start and end:** `cfe04b903bed86d6bf8fcb82c654070830241bd0` (unchanged — nothing pushed).
**Claude branch:** `claude/full-platform-takeover`
**Claude HEAD:** `a17e51e`

## Local commits on this branch (in order, all unpushed)

1. `8a051b7` — Alpaca PAPER readiness: latency capture, deduplicated config-failure
   helper, 12 new tests exercising `checkAlpaca`/`checkOptionomics` state mapping.
2. `7ff290a` — Real Python quant models: `management_action_value.py`,
   `assignment_model.py`, `recovery_decision.py`, `covered_call_ranker.py`, `aegis.py`,
   `sizing.py`, `execution_quality.py` (all transparent baselines, MODEL-001). Fixed a
   real pre-existing gap: `CandidateAction` enum was missing `CALL_AWAY`.
3. `f24dc3e` — TS contracts (Zod-validated, versioned) for the four new Python model
   families, plus two tested state machines: THETA lifecycle (`runtime-state.ts`) and
   order-intent lifecycle with idempotent `client_order_id` generation
   (`order-intent-state.ts`).
4. `cc80691` — this handoff document, first version.
5. `a17e51e` — Opportunity-frontier anti-paralysis engine
   (`opportunity_frontier.py`): WAIT-vs-PASS classification with per-candidate
   sub-reasons (WAIT_PRICE/WAIT_VOL/WAIT_LIQUIDITY/WAIT_EVENT/WAIT_REGIME), book-level
   ranking, and an auditable `GlobalIdleReport` (never a bare "WAIT" when the engine
   takes no new risk). Plus `hold_advantage()` on `management_action_value.py` (named
   `U_HOLD - max(alternatives)` quantity, the antidote to a fixed 25/50/75% TP rule).
   23 new tests, 225/225 total Python tests passing. Explicitly did NOT durabilize an
   unverified 20-repository GitHub corpus or additional named traders (MAR1 QUANT,
   EnhancedMarket, Renee, Swayd, TeamTape) referenced in the prompt that produced this
   commit — see `docs/quant/phase5_management/OPPORTUNITY_FRONTIER_ENGINE.md`'s
   non-fabrication note.

## Last completed phase/subphase

**R1 (Phase 2C runtime orchestration): PARTIAL.**

Done:
- Contracts: `src/theta/management-contract.ts`, `aegis-contract.ts`,
  `sizing-contract.ts`, `execution-quality-contract.ts` — all Zod-validated,
  versioned, enforcing key invariants at the schema level (HOLD-only-selectable-when-
  unknown, exit-supremacy actions always present, quantity-zero-implies-zero-capital,
  SUBMIT-never-recommended-when-unknown).
- `src/theta/runtime-state.ts` — THETA lifecycle state machine, explicit transition
  table, tested happy paths and rejected invalid transitions.
- `src/theta/order-intent-state.ts` — order intent state machine with the critical
  `UNKNOWN_SUBMISSION -> RECONCILING` (never `-> SUBMITTING`) invariant enforced
  structurally, plus deterministic idempotent `client_order_id` generation.

**Not done (R1 remaining scope):**
- R1A: the state machines exist but are not yet wired to any persistence layer (no DB
  writes yet — that's R2's ledger).
- R1B: order-intent state machine exists as a pure state-transition library; no actual
  Alpaca order submission code has been written (correctly — that's gated behind R7).
- R1C: **scheduler/worker abstraction not started at all.**
- The ownership/regime/candidate-generation TS adapter layer is **not built** — only
  the management/AEGIS/sizing/execution-quality contracts exist. `theta-q-contract.ts`
  (pre-existing, Codex-authored) already covers entry-candidate evaluation; there is no
  equivalent adapter yet for `ownership_v0.py`/`regime_v0.py` outputs specifically as
  TS-consumable contracts (they're currently only consumed indirectly via the Python
  models that use them internally).
- R1D: most of the listed test scenarios are covered (see commit `f24dc3e`'s test
  files), but **provider-degradation-affecting-runtime**, **runtime restart**, and
  **duplicate decision prevention** at the orchestration level are not yet tested,
  since no actual orchestration/persistence code exists yet to test.

**R2 through R9: NOT STARTED.** No reconciliation/ledger code, no customer broker
architecture, no copy engine, no UI changes, no empirical/replay engine work happened
in this session beyond what was already committed in earlier sessions
(`docs/quant/phase2/` through `phase5_management/`, all research/specification only).

## Files changed this session

See the three commit messages above for the exact file list. No migrations were
created or modified. No `.sql` files touched.

## Tests

- Python: 225/225 passing (`python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"`).
- TypeScript: 68/68 passing (`npm test`).
- Lint (`npm run lint`): clean.
- Typecheck (`npm run check`): clean.
- Build (`npm run build`): clean.
- Secret scan (`node tools/security-scan.mjs`): 0 findings, 204 paths scanned.
- Not run this session: `npm run test:browser` (Playwright), `npm run scan:security`
  is the same script as `security-scan.mjs` above (already run), `npm audit`, database
  migration tests, schema invariant checks — none of these are relevant to a
  docs/quant-model/contract-only change set, and no migration or schema file was
  touched.

## Known blockers

1. **No scheduler/worker abstraction exists** — R1C is unstarted. This blocks any real
   runtime orchestration (the contracts/state machines built this session are
   building blocks, not yet an assembled runtime).
2. **No ownership/regime TS adapter contracts** — needed before a full
   FusionSnapshot-to-decision pipeline can be assembled in TypeScript.
3. **Alpaca options historical/live entitlement status is still unconfirmed** (per
   `docs/DATA_READINESS_ASSESSMENT.md`, unchanged this session) — affects R6 (empirical)
   and any real R3 (customer broker) capability claims, not R1's contract work.
4. **No customer-facing Alpaca OAuth flow exists** — R3C is unstarted; this is a
   nontrivial, security-critical design (token storage, tenant isolation) that was not
   attempted this session given the scope already covered.

## Known financial/technical risks

- None introduced this session — every change is either a pure specification, a
  pure-function transparent-baseline model, or a schema/state-machine validator with
  no I/O and no broker/provider call.
- The AEGIS contract's `permittedActions` field is currently populated by whatever the
  Python-to-JSON serialization layer sends — **that serialization/adapter code does
  not exist yet.** When it's built, it must call `aegis.py`'s `is_action_permitted`
  for every action of interest and populate the list from that, never hand-write a
  duplicate permission table in the adapter. Flagged here explicitly so this isn't
  rediscovered as a design question later.

## Provider calls / broker calls / orders this session

**NONE.** No Alpaca API call was made. No Optionomics API call was made. No PAPER or
LIVE order was submitted, proposed for submission, or simulated as submitted.

## Exact next task for whoever continues (Codex or a future Claude session)

1. Build the scheduler/worker abstraction (R1C) — a restart-safe interface capable of
   market-open reconciliation, candidate scans, position-management checks,
   pre-expiry checks, post-close reconciliation, provider-health checks. Explicitly
   NOT a Vercel serverless function — Vercel stays web/API only, per this task's own
   R1C instruction.
2. Build TS adapter contracts for `ownership_v0.py` and `regime_v0.py` outputs,
   mirroring the existing `theta-q-contract.ts`/new contract files' pattern.
3. Assemble the actual runtime pipeline (R1 diagram, section 4 of the takeover
   instruction) — FusionSnapshot through to OrderIntent persistence — using the
   contracts and state machines already built.
4. Only after R1 is genuinely complete and tested: proceed to R2 (durable
   ledger/reconciliation).

## Commands to verify current state

```
git fetch origin
git log --oneline --decorate -12
git diff origin/main..claude/full-platform-takeover --stat
python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
npm run check && npm run lint && npm test && npm run build
node tools/security-scan.mjs
```

---

## CLAUDE → CODEX BATON

```
==================================================
CLAUDE → CODEX BATON
==================================================
ORIGIN_MAIN_SHA: cfe04b903bed86d6bf8fcb82c654070830241bd0 (unchanged)
CLAUDE_BRANCH: claude/full-platform-takeover
CLAUDE_HEAD: f24dc3e
LAST_COMPLETED: R1 partial -- management/AEGIS/sizing/execution-quality TS contracts,
  THETA lifecycle + order-intent state machines. R2-R9 not started.
CURRENT_IN_PROGRESS: R1 (scheduler/worker abstraction and ownership/regime adapters
  are the next concrete steps within R1, not yet begun)
LOCAL_COMMITS_TO_REVIEW: 8a051b7, 7ff290a, f24dc3e (all on claude/full-platform-takeover,
  none pushed, none merged)
FILES/MIGRATIONS: no migrations touched; see commit messages for full file list
  (7 Python quant models + tests, 6 TS contract/state-machine files + tests, 3 docs
  updates)
TESTS: 225/225 Python, 68/68 TS, lint/typecheck/build clean, secret scan 0 findings
PROVIDER_CALLS: NONE this session
ORDERS_SUBMITTED: NO
FIRST_PAPER_ORDER_GATE: NOT REACHED -- R2 through R7 have not been built yet, so the
  gate is far from evaluable, let alone passable
KNOWN_BLOCKERS: no scheduler abstraction; no ownership/regime TS adapters; no customer
  broker OAuth design; Alpaca options entitlement still unconfirmed
KNOWN_RISKS: AEGIS contract's permittedActions field depends on a not-yet-built
  Python-to-JSON adapter that must call is_action_permitted() rather than
  reimplementing the permission table -- flagged for whoever builds that adapter
EXACT_NEXT_TASK: build the scheduler/worker abstraction (R1C), then ownership/regime
  TS adapter contracts, then assemble the actual FusionSnapshot-to-OrderIntent
  pipeline using what already exists
RECOMMENDED_CODEX_REVIEW: the AEGIS/sizing/execution-quality contract designs
  (src/theta/*.ts) for fit against however the real Python-to-TS bridge ends up being
  implemented (subprocess? HTTP service? Both this repo's existing ThetaQClient
  interface and this session's new contracts assume SOME such bridge exists or will
  exist -- it is not built in this session, since it wasn't clear whether Codex had
  already started one elsewhere)
==================================================
```
