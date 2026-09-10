# Current Engineering Handoff

## 2026-09-10 functional connection milestone

OWNER: Codex

TASK: Build the real application path for master PAPER verification, customer
identity, Alpaca Connect OAuth, encrypted follower token storage, durable allocation,
and truthful owner/customer readiness. Integrate compatible Claude R1 runtime work
without claiming that SHADOW is running.

FILES CHANGED: migration 006, customer auth/security/store/OAuth/API modules, master
readiness projections, customer and owner UI, API and OAuth architecture docs, tests,
and security scanning rules. Selected Claude R1 commits are present in main history as
separate commits.

WHAT WAS IMPLEMENTED:

- Distinct master and follower Alpaca trust domains. Master credentials remain server
  environment references. Followers use Alpaca authorization-code OAuth with
  env=paper and no raw-key UI.
- Stable customer UUID identity, salted scrypt passwords, opaque hashed sessions,
  customer-bound single-use OAuth state, and AES-256-GCM follower token encryption.
- Read-only follower account, positions, and open-order verification before readiness.
- Durable follower account, participation, allocation, and policy persistence.
- Owner master and combined provider verification endpoints with safe HTTP and
  operation metadata. No credential value is returned.
- A compact three-step copy experience. Only the current step is shown and advanced
  limits are collapsed.
- R1 provider normalization, opportunity assembly, hard-gate proof, and decision
  assembly were selectively integrated. Runtime status remains
  R1_INTEGRATED_INPUT_ASSEMBLY_BLOCKED.

KNOWN LIMITATIONS AND RISKS:

- Production lacks DATABASE_URL and Alpaca Connect/token-vault configuration, so a
  real follower OAuth round trip cannot run yet.
- Existing deployment master credentials were previously exposed in conversation and
  must be rotated before they are used for a new real verification claim.
- The customer identity layer needs rate limiting, verified email, recovery, MFA, and
  broader security operations before public production release.
- Docker was unavailable locally, so migration 006 must be executed by CI against its
  disposable PostgreSQL service before it can be trusted.
- SHADOW is not running. Real ownership/regime/event input assembly, a restart-safe
  scheduler, and persisted shadow receipts remain required.
- Follower order intent contracts exist, but broker order submission stays locked and
  no worker is active.

WHAT THE OTHER AGENT SHOULD REVIEW: Claude should review only the final runtime input
assembly interface and management/AEGIS semantics. Customer OAuth, IAM, persistence,
and owner controls remain Codex-owned integration surfaces.

NEXT RECOMMENDED TASK: configure the approved PAPER Alpaca Connect application and
managed PostgreSQL secrets, run a real customer OAuth round trip, then complete the
R1 scheduler and persisted read-only shadow-decision slice. The first PAPER order is a
separate explicitly authorized milestone.

## 2026-09-10 Codex integration note

Claude source through `04a7975` was audited and merged into `codex/phase2-copy-ops` from main `cfe04b903bed86d6bf8fcb82c654070830241bd0`.

The merged runtime contracts preserve UNKNOWN values, quantity zero, executable-price provenance, RECOVERY_WAIT, reason-specific WAIT scheduling, AEGIS exit supremacy, deterministic order intent IDs, and ambiguous-submission reconciliation. They contain no provider I/O or order submission path.

R1 remains PARTIAL. Quant baselines, the allowlisted Python bridge, strategy router, Pareto frontier, TypeScript contracts, and management assembly are present. Live option candidate generation, persistent opportunity book and ledger, broker execution, reconciliation, and follower copy execution remain blocked. The management action-value interface also needs a joint quant review to make its valuation origin explicit and prevent entry premium from being counted twice when comparing current-timestamp forward alternatives.

Customer copy setup and `/ops` are product and API foundations only. See `docs/THETA_V1_2_PAPER_COPY_EXTENSION.md`.

Vercel Production stores `ALPACA_BASE_URL` and `OPTIONOMICS_EMAIL` as Sensitive values. They were corrected on 2026-09-10, but Vercel CLI 59.1.3 substitutes an 11-character non-secret placeholder during local `env pull` and `env run`. Safe diagnostics confirm this placeholder is neither a URL nor an email. Local provider readiness therefore stops at configuration validation. Sensitive storage was preserved and no provider authentication claim is made from that run.

Reticle project wiring is present and connected successfully, but `.agents/skills/reticle/SKILL.md` and saved `.reticle/flows` are absent from this branch. `reticle verify` correctly refused to report a pass for zero saved flows. Playwright supplied the desktop, tablet, mobile, overflow, and WCAG AA evidence for this milestone.

**Last updated:** 2026-09-10, end of this Claude takeover session (continuation pass).
**Origin/main SHA at session start and end:** `cfe04b903bed86d6bf8fcb82c654070830241bd0` (unchanged — nothing pushed).
**Claude branch:** `claude/full-platform-takeover`
**Claude HEAD:** `4545e18`

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
6. `78edb29` — handoff update for the anti-paralysis milestone.
7. (pending, this update) — Product-correction durable specs:
   `docs/product/CUSTOMER_COPY_UX.md`, `OWNER_OPS_IA.md`, `COPY_THETA_FLOW.md`,
   `ALPACA_OAUTH_ARCHITECTURE.md`, `CUSTOMER_VS_ADMIN_INFORMATION_BOUNDARY.md`.
   Specification only, per the product correction's own priority order (R1-R4 runtime
   first, UI wiring after) — **no UI code changed**. Captures: customer-language
   correction (drop "Explore THETA"-style research framing), simplified nav (Home/
   Bots/My Bots/Activity/Account), Alpaca customer-OAuth architecture (never a pasted
   secret, mirrors the existing PAPER-only assertion pattern), owner `/ops` IA (12
   sections), five-step Copy THETA wizard, and the exact customer-vs-admin
   information-boundary line.
8. `e329b6a` — R1C scheduler job model (`scheduler.ts`) + scheduling policy
   (`scheduling-policy.ts`, WAIT-reason-specific recheck triggers + urgency-scaled
   position-management scan interval) + R1D ownership/regime TS contracts
   (`ownership-contract.ts`, `regime-contract.ts`). 26 new tests, 94/94 TS total,
   225/225 Python unaffected.
9. `322d2f6` — handoff update.
10. `b193d79` — `option-contract.ts` (canonical normalized option-contract shape,
    exact field list from the task, UNKNOWN-preserving, executability determination),
    `shadow-opportunity-book.ts` (contract + validating in-memory builder for every
    evaluated candidate outcome — persistence itself deferred to R2),
    `decision-assembly.ts` (`assembleNewRiskDecision`: composes already-computed
    frontier/AEGIS/sizing/execution-quality results into one `NewRiskDecisionReceipt`,
    zero quantitative computation of its own, fails closed on provider/version/
    ownership/regime/snapshot problems, `executionAuthorized` always `false`).
    39 new tests, 126/126 TS total, 225/225 Python unaffected.
11. `cc46803` — handoff update.
12. `017e4e3` — `strategy_router.py` (contextual strategy router: StrategyFamily/
    LifecycleState/EligibilityState/ModelDisagreementState, `route_strategies()` —
    "specialists, not voters," one family's ineligibility never suppresses another's,
    tested directly), `strategy-router-contract.ts` (enforces exactly six results per
    response), `management-assembly.ts` (R1H: composes management_action_value.py +
    hold_advantage() + AEGIS + execution-quality into one receipt, exit supremacy
    enforced structurally, fails closed on version/snapshot mismatch). Plus six
    durable specs under `docs/quant/phase6_router/`: router design rationale,
    expert-routing matrix (grounded strictly in the existing 11 experts), hard-gate-
    vs-soft-feature registry (2 real gaps flagged), timeframe/horizon registry,
    Python↔TS bridge architecture (SPECIFIED only — the biggest remaining R1 gap),
    FusionSnapshot completeness audit (4 gaps named, none fixed), strategy-routing
    shadow-record + RouteRegret spec. 31 new tests (14 Python + 6 + 11 TS), 239/239
    Python total, 143/143 TS total.

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
TESTS: 253/253 Python, 167/167 TS, lint/typecheck/build clean, secret scan 0 findings

## Latest milestone: R2 economic lifecycle ledger (`4545e18`)

- `migrations/004_economic_lifecycle_ledger.sql` + `tests/sql/004_economic_lifecycle_ledger.sql`
  — economic_chain/option_leg/stock_lot/order_intent/broker_order/fill/assignment_event/
  expiration_event/dividend_event/fee_event/reconciliation_event. Roll = new linked row,
  never a mutated realized_pnl (immutability trigger enforces this). Assignment never
  auto-sets stock_lot.realized_pnl. **NOT executed against a live Postgres this session
  — Docker Desktop's engine is unreachable in this environment.** Written to match
  migrations/001-003's exact conventions; needs real execution (Codex's CI already runs
  this) before being trusted as correct SQL. Flagged in
  `docs/quant/phase6_router/R2_LEDGER_STATUS.md`.
- `src/theta/ledger-contract.ts` — TS-side mirror + `computeWholeChainPnl()`. Genuinely
  tested, 11/11 passing (caught and fixed a real bug while testing: dividends must scale
  by the paying lot's share count).

## Latest milestone: Pareto-dominance frontier + OPEN_ALTERNATE_EXPIRY (`a8d092c`)

Credential-free R1/quant work, per "one failed setup must not become WAIT":
- `opportunity_frontier.py`: added `OPEN_ALTERNATE_EXPIRY` (distinct from
  `OPEN_ALTERNATE_CONTRACT`). A negative-EV candidate now tries alternate expiry, then
  alternate contract, before PASS.
- `pareto_frontier.py` (new): multi-dimensional dominance filtering across EV_net/
  EdgeBuffer/ReturnPerCapitalDay/fill-probability (maximize) and tail-loss/assignment-
  probability/severe-drawdown-probability/capital-requirement/capital-days/spread/
  slippage/uncertainty (minimize). UNKNOWN dimensions excluded from comparison, never
  treated as favorable/unfavorable. `gross_credit` deliberately excluded as a
  dominance dimension (that's the naive BQ-1/BQ-2 policy this replaces).
17 new tests, 253/253 Python total.

## CREDENTIAL BLOCKER (found this session, still open)

No real Alpaca PAPER or Optionomics credentials exist anywhere in this development
environment: `.env.local` exists but contains none of `ALPACA_API_KEY`/
`ALPACA_SECRET_KEY`/`ALPACA_BASE_URL`/`OPTIONOMICS_API_KEY`/`OPTIONOMICS_EMAIL`
(checked via `dotenv.parse`, presence/length only, never values printed), and none of
these are set in the process environment either. This blocks R1F (real Alpaca PAPER
option-chain pipeline) and the R1 end-condition (a real-data end-to-end shadow run)
entirely — not a corner cut, a missing external dependency. Whoever has real THETA
PAPER credentials needs to add them to `.env.local` (which is correctly gitignored)
before R1F can be attempted for real.

## Latest milestone: Python<->TS bridge + FusionSnapshot completion (`b147d54`)

- `src/theta/python-bridge.ts` — R1I, the controlled bridge per
  `docs/quant/phase6_router/PYTHON_TS_BRIDGE_ARCHITECTURE.md`. No shell invoked, fixed
  script allowlist, timeout, max-output cap, stderr secret redaction, full
  version/snapshot/schema validation, all fail-closed. 13 tests using real Python
  fixture scripts (`tests/fixtures/python-bridge/`).
- `src/market/fusion-snapshot.ts` — all 4 documented audit gaps fixed:
  `contractCandidates` now uses the real `normalizedOptionContractSchema` (was
  `z.unknown()`), plus new `providerHealth`, `portfolioExposure`,
  `strategyRouterState` fields. Two dependent test fixtures (`fusion-snapshot.test.ts`,
  `evaluation.test.ts`) updated to match — all their existing tests still pass.
- `strategy_router.py` — added an explicit disclaimer that its ownership floors are
  versioned research/default parameters, never claimed production-optimal.
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
