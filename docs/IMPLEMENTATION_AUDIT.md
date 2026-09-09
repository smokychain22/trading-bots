# THETA Implementation Audit — Engineering Pass

Owner: production engineering (Node/TS control plane, Postgres, Redis, Alpaca/Optionomics
adapters, FusionSnapshot, lifecycle state machine, accounting, AEGIS integration, order
state machine, observability). This is the first-task deliverable required before any
major functionality is written: repo inspection, spec inventory, inconsistency list,
and the phased plan in `docs/PHASED_PLAN.md`. **No application code was written to
produce this audit.**

## 1. Repository state

As of this audit, the repo (`9b312ec`, "Scaffold THETA v1 repository structure and
canonical documentation") contains only Phase-0 scaffold: `CLAUDE.md`, `.gitignore`,
`docs/` (ownership split, quant implementation map, phased plan, research register,
and the canonical specs themselves), and an empty `bots/theta/{app,quant,migrations,
tests}` directory tree with `.gitkeep` placeholders. **No package.json, tsconfig,
Docker, CI, or database connection exists yet.** Working tree was clean before this
audit; nothing here modifies that.

## 2. Canonical document inventory and version hierarchy

Verified by reading full document text (TRD, PRD, Backend Schema) and diffing the
superseded candidates against their v1.1 successors — not inferred from filenames.

| Document | Status | Evidence |
|---|---|---|
| `THETA_v1_1_FINAL_TRD_Alpaca_Optionomics_2026-09-09.docx` | **Canonical, frozen.** Read in full (previous session). | Its own §58 "TRD Freeze and Handoff Contract" declares itself the technical source PRD/Schema may not silently override. |
| `THETA_v1_1_FINAL_PRD_Alpaca_Optionomics_2026-09-09.docx` | **Canonical.** Read in full this session. | Cites "THETA v1 TRD v1.1 FINAL" as its own canonical technical source (§0). |
| `THETA_v1_1_FINAL_PRD_Alpaca_Optionomics_2026-09-09 (1).docx` | Duplicate, byte-identical to the file above (`diff` confirmed, zero output). | Keep one copy; the "(1)" is a redundant download, not a distinct revision. |
| `THETA_v1_1_FINAL_Backend_Database_Schema_Alpaca_Optionomics_2026-09-09.docx` | **Canonical.** Read in full this session. | Declares TRD v1.1 FINAL + PRD v1.1 FINAL as its parents; "implements them, does not redefine strategy logic" (§0). |
| `THETA_v1_1_PostgreSQL_Bootstrap_Schema_2026-09-09.sql` | **Canonical bootstrap starting point**, not a migration system. Read in full this session (629 lines). | Its own header says "application migrations become authoritative after bootstrap." |
| `THETA_v1_TRD_Alpaca_Optionomics_2026-09-09.docx` (bare, no version number) | **Superseded — this is TRD v1.0**, not a fourth distinct document. | Its own doc-control table reads "Version 1.0 | 9 September 2026." Confirmed by reading its header directly. |
| `THETA_v1_0_FINAL_PRD_Alpaca_Optionomics_2026-09-09.docx` | Superseded by PRD v1.1 FINAL. | Doc-control header confirms "PRD Version 1.0 FINAL"; already cites TRD v1.1 FINAL as its technical source, i.e. it was already trailing the TRD by the time it existed. |
| `THETA_v1_0_FINAL_Backend_Database_Schema_Alpaca_Optionomics_2026-09-09.docx` | Superseded by Schema v1.1 FINAL. | Doc-control header confirms "Schema Version 1.0 FINAL." |
| `THETA_v1_0_PostgreSQL_Bootstrap_Schema_2026-09-09.sql` | Superseded. | `diff` against the v1.1 bootstrap (below) shows v1.1 is a strict additive superset — no unique content in v1.0 that v1.1 dropped. |

**v1.0 → v1.1 SQL bootstrap diff, verified directly:** v1.1 adds
`risk.sizing_decision`, `risk.correlation_snapshot`, `risk.exposure_cluster_snapshot`,
`risk.exposure_cluster_member`, `market.optionomics_feature_family_contract`,
`unit_basis`/`normalization_version` columns on `option_greeks_snapshot`,
`family_contract_version` FK-enforcement on `optionomics_feature_snapshot`, and the six
`analytics.v_*` read views. Nothing was removed. This matches exactly what the v1.1
schema doc's own "v1.1 completeness additions" line (§0) claims. **Conclusion: no
value is lost by treating v1.0 documents as historical only; do not build against
them.**

**Blueprint PDF lineage** (`Independent_AI_Options_Bots_Blueprint_v5_1/v5_2/v5_4...`):
per the Backend Schema's own Appendix G source register, this lineage is "provider
split, THETA complete-cycle economics, expert priors, validation and copy-compatible
design" evidence — explicitly **not build authority**. A separate research pass is
reading v5.1/v5.2/v5.4 in depth to confirm nothing engineering-relevant is missing
from the frozen v1.1 set; *(see "Blueprint cross-check" section below — filled in once
that pass completes)*.

## 3. Genuine inconsistencies requiring a decision before coding

### 3.1 `broker_order` cardinality vs. cancel/replace lineage — needs a decision

`trade.broker_order` (both v1.0 and v1.1 bootstrap, unchanged) has:

```sql
order_intent_id uuid NOT NULL UNIQUE REFERENCES trade.order_intent(order_intent_id),
provider_order_id text NOT NULL UNIQUE,
...
replaced_by_id uuid REFERENCES trade.broker_order(broker_order_id),
```

`trade.execution_attempt` separately supports **multiple attempts per order_intent**
via `(order_intent_id, attempt_no)`. But `broker_order.order_intent_id` is `UNIQUE` —
so exactly one broker order can ever exist per order_intent, while `replaced_by_id`
implies a chain of *multiple* broker orders. Alpaca's own replace semantics (TRD
Appendix B, S7/S9) issue a **new** `provider_order_id` on a PATCH-replace, linked back
via a `replaces` reference — which is exactly the shape `replaced_by_id` is modeling.

This is a real ambiguity in the frozen schema, not something engineering should
silently resolve either way: **does an adaptive-limit reprice (TRD §44 ladder: refresh
BBO → recompute EV → replace or cancel) mint a new `order_intent` each time (so the
UNIQUE constraint holds, one broker_order per intent, and `replaced_by_id` chains
across sibling order_intents), or should the UNIQUE constraint be relaxed to
`UNIQUE(order_intent_id, provider_order_id)` so one intent can own a chain of broker
orders directly?** Both are internally consistent designs; the schema currently
implies both at once. This must be settled — with a documented rationale — before the
execution engine (my ownership) is built, since it changes what "idempotent by
decision_id/client_order_id" (EXEC-001) means in practice for a repriced order.
**Recommendation:** treat each reprice as a new `order_intent` (new deterministic
`client_order_id` derived from `decision_id` + attempt ordinal), keep
`execution_attempt` as the pre-submit retry/timeout ledger *within* one intent, and use
`broker_order.replaced_by_id` to chain intents' broker orders together for TCA/audit.
This preserves the existing UNIQUE constraints without a migration change. Flagging
for confirmation rather than unilaterally implementing, since it's a schema-semantics
question, not a pure coding one.

### 3.2 Bootstrap is intentionally incomplete relative to the schema spec — expected, but must be tracked, not silently patched over

The schema doc's own Appendix C lists 13 `analytics.v_*` read views; the bootstrap
implements 6 (`v_open_wheel_chains`, `v_managed_episode_performance`,
`v_optionomics_feature_latest`, `v_portfolio_greeks_current`, `v_correlation_latest`,
`v_exposure_clusters_current`). Missing: `v_current_bot_status`,
`v_whole_chain_performance`, `v_opportunity_capture`, `v_execution_tca`,
`v_model_calibration`, `v_provider_health`, `v_audit_replay_manifest`. None of these
block Phase 0/1 (they're operational/reporting views, needed by Phase 6 onward), but
they must land in the migration set — not be silently dropped because the bootstrap
didn't include them.

`research.gate_regret_summary` (schema §22, explicitly marked "optional
materialized/derived table") is absent from the bootstrap. Low priority; note and
defer, don't build it speculatively ahead of the shadow-trading phase that needs it.

No partitioning exists anywhere in the bootstrap (schema §30 requires monthly
`RANGE` partitioning on `provider_request`, quote/feature snapshots,
`model_prediction`/`risk_snapshot`, `audit_event`, correlation snapshots). This is
**expected** — the bootstrap's own header says it "intentionally favors standard
PostgreSQL; application migrations become authoritative after bootstrap" — but it's a
concrete Phase 0 migration-design task, not something to defer indefinitely: retrofit-
partitioning a live append-only table is expensive, so partitioning strategy should be
decided in the *first* migration for each high-volume table, not bolted on later.

No DB-role/permission separation exists (schema §31: "Separate migration owner,
app_readwrite, app_readonly/auditor, research writer; immutable event tables deny
UPDATE/DELETE to normal app roles"). This is a `[MUST]` (AUDIT-001, IAM-001), not an
optional hardening step, and it's cheap to do correctly in migration `015` (the
indexes/partitions/views/permissions migration the schema doc's own migration order
already reserves for this) rather than retrofitted after data exists. Row-level
security is explicitly **not** required yet — the schema doc itself says "RLS can be
added before external multi-tenant launch" — so don't build RLS speculatively for a
single-workspace v1.

### 3.3 Scope clarification: copy trading and the 70–80% target

The user's brief for this task says the goal is to make THETA "profitable enough so
users can copy trade them." Both canonical documents already address this directly,
and it doesn't require redesigning anything:

- PRD v1.1 FINAL §49.2: **"No follower product in v1."** The episode/order/fill/audit
  architecture already preserves master-fill timing and actual quantity/fills
  specifically so a future follower-replication feature can be added later "without
  rewriting P&L truth" — but building that follower product is explicitly deferred,
  not part of this task or any near-term phase.
- Backend Schema §4 "Physical-Model Principles": **"Future copy compatibility.
  Workspace/account IDs and actual fill lineage are preserved so follower replication
  can be added later without rewriting master P&L truth."** This is already designed
  in — nothing in the current schema needs to change to keep that door open.

So: the schema is already copy-trading-*compatible* by construction. What is **not**
in scope, now or as a result of this task, is building the follower/copy-execution
product itself, and — critically — **treating "profitable enough for users to copy"
as license to loosen the validation standard.** Per CLAUDE.md's non-negotiable rules
and TRD §2.2/§50, the 70–80% figure stays a Managed Episode WR research target for
named, validated high-confidence cohorts, reported alongside Leg WR, Whole-Chain WR,
open MTM, AvgWin/AvgLoss, PF, and drawdown — never a number to reach by adjusting
models or the OOS split. If THETA's honest, validated performance is a lower win rate
with a better payoff/drawdown profile, that's what graduates and that's what gets
reported to any future copy-following user.

### 3.4 Security finding: exposed-looking credentials file

`C:\Users\hp\Downloads\env` exists (confirmed by file listing only — **not read**,
per this repo's non-negotiable rule against exposing credentials). A prior audit
session (Codex, before this repo existed) already flagged a similarly-named env file
in the user's Downloads as containing "active-looking provider and webhook
credentials," unused, and recommended rotation. This file was not opened, was not
copied anywhere, and is excluded from git by `.gitignore` patterns (`.env`, `.env.*`,
`*secret*`, `*credentials*`) — though note the bare filename `env` (no leading dot)
would **not** be caught by dotfile-style patterns if it were ever placed inside the
repo tree. **Recommendation to the user:** rotate/revoke whatever Alpaca and
Optionomics keys that file contains now, independent of anything in this repo, since
multiple sessions have now referenced its existence. Engineering will never read or
transcribe its contents as part of this or any future task.

## 4. Missing implementation prerequisites (must resolve before the phase that needs them)

| Prerequisite | Needed before | Why |
|---|---|---|
| Resolve the `broker_order`/`order_intent` cardinality question (§3.1) | Phase 5 (execution/order state machine) | Determines the shape of every order-placing code path and its idempotency contract. |
| Partitioning strategy per high-volume table | Phase 0 migration design | Retrofitting partitioning onto a populated append-only table is expensive; decide in the first migration that creates each table. |
| DB role/permission separation + UPDATE/DELETE denial on immutable tables | Phase 0 migration `015` | `[MUST]` (AUDIT-001/IAM-001); currently unimplemented in the bootstrap. |
| Optionomics operation-alias binding to the *current* live API Reference | Phase 2 | TRD OPT-001 forbids guessed paths; the bootstrap's `provider_operation_registry` and `optionomics_feature_family_contract` tables exist, but no adapter has bound them to real Optionomics endpoints yet — this requires live verification against `docs.optionomics.ai`, not assumption from the TRD's illustrative alias names. |
| Alpaca OPRA entitlement confirmation | Phase 1 exit gate, hard-blocks any live-quality decisioning | TRD §8.2: Basic/indicative feed is explicitly non-execution-grade; must be confirmed on the actual account before any paper/live BBO-driven logic is trusted. |
| Missing analytics views (§3.2) scheduled into migration `015` | Phase 6 (research/shadow reporting needs them) | Not urgent now, but must not be silently dropped from the plan. |

## 5. What this audit deliberately does not do

No code, no migrations, no package.json, no Docker files were created. Per this
repo's working agreements (`CLAUDE.md`), Phase 0's remaining engineering work
(TypeScript/Python workspace scaffolding, Docker Compose, CI, the actual migration
conversion of the bootstrap SQL) is the next task, not this one — see
`docs/PHASED_PLAN.md` and `docs/ENGINEERING_IMPLEMENTATION_MAP.md` for what comes next
and in what order.

## 6. Blueprint cross-check (v5.1 / v5.2 / v5.4) — complete

A full read-through (via extracted text, page by page) of the three blueprint PDFs
named in this task confirms the following against the frozen TRD/PRD/Schema v1.1:

**v5.1 (QuantWheel update) — confirmed non-issue.** QuantWheel is never treated as a
required runtime dependency anywhere in the document. It states plainly that
QuantWheel is "process/decision support, not secret alpha" — valued only as an
offline behavior source to reverse-engineer as priors, not as product integration. It
even warns that QuantWheel's own public docs are internally inconsistent about live
capability and prescribes capability-testing rather than trusting a roadmap page —
consistent with this repo's own OPT-001 discipline (never guess a provider contract).
No concrete endpoint contract for THETA-to-QuantWheel integration is specified
anywhere. This fully agrees with TRD's no-new-vendor constraint and PRD §49.1. **No
contradiction found; no action needed.**

**v5.2 (premium-capture economics) — mostly absorbed; one non-blocking gap.** Core
economics (`EV_net`, `PF_net`, `BreakEvenWR`, `EdgeBuffer`, `ShortOptionCapture`,
`NetRollCredit`, `RollUtility`, `THETA_CycleUtility`, Brier/LogLoss) match TRD Appendix
A verbatim or near-verbatim. **Genuinely new, not in Appendix A:** a cluster of
covered-call/roll *diagnostic* display metrics — `CoveredCallStrikeUplift`,
`AdditionalUpsideDollars`, `RollAnnualYield`, `RollCreditPerAddedDay`,
`GrossCloseProfit`, `ExactCapture`, `ResidualPremiumFraction`, `EarnedToResidual`, and
a `ParetoCriteria` multi-objective roll comparison. None of these contradict or
compete with Appendix A's core risk/EV math — they're secondary reporting metrics.
**Do not implement these silently.** If the CC/roll workspace UI later needs richer
diagnostics than Appendix A provides, propose them as a named TRD amendment (per §58's
own handoff contract) rather than adding them ad hoc during coding.

**v5.4 (canonical ancestor) — fully absorbed on THETA mechanics; two ideas worth
flagging, not building now.** Its event-sourced ledger design, `ROLL = CLOSE_OLD +
OPEN_NEW` framing, source-of-truth hierarchy, and execution/TCA discipline are
restated near-identically in TRD §25/§27 and Schema §19–21 — nothing new for
engineering there. Two things worth carrying forward as *noted*, not built:
1. A "mechanism attribution" idea (`ExpectedMechanism != RealizedPnLDriver` → investigate/quarantine model version) that verifies THETA is actually earning theta/premium-decay economics rather than profiting by directional accident. This is quant-side (Claude's ownership, `research.model_drift_event` is adjacent but not identical) — worth a future proposal, not an engineering gap.
2. A specific claim that "Alpaca currently does not support equity+option MLeg combos; uncovered-leg restrictions affect some rolls/calendars." **This is a static snapshot from an older document and must be capability-tested against Alpaca's current live docs before the roll executor is built** — TRD's own ROLL-003 already requires failing safe to a close-then-open state machine if MLeg is unsafe, so the engineering behavior is already correctly specified; this is just a reminder not to assume MLeg availability from an old PDF.

**Copy trading across all three — more developed historically than the frozen docs
admit, but still explicitly deferred.** v5.4 devotes several sections and two
appendices to a fairly mature copy-engine design (event-sourced replication, follower
preflight, entry/exit degradation modeling, capacity curves). None of this is
reflected in TRD/PRD v1.1 beyond the one-line "future compatibility, master-fill-first,
deferred" statements already cited in §3.3 above. **This changes nothing about the
current phase** — it confirms that if/when the user wants to build actual copy trading
later, there's a legitimate design starting point to mine from the blueprint lineage,
but building it is not authorized by this task, this audit, or any phase in
`docs/PHASED_PLAN.md` up to Phase 8.

**Overall verdict: the frozen v1.1 TRD/PRD/Schema set remains complete and
sufficient authority for engineering work. No blueprint content requires a TRD
revision to proceed with Phase 0/1.**
