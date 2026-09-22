# THETA required-vs-optional evidence matrix (pre-VPS Wave 2, Slice 17)

**Correction (Wave 2 Slice 18, 2026-09-22):** this document's own row-by-row table below was always complete
(all 33 capabilities, including all 6 newly added ones, were listed as rows). What was wrong was the summary
arithmetic: Section 0's "27 entries as of Slice 15" and Section 2/3's "Total: 28" both inherited a miscounted
baseline from `THETA_CAPABILITY_REGISTRY_RECONCILIATION_2026-09-22.md` (which understated the pre-Slice-15
registry as 22 records instead of the actual 27). The registry actually holds **33** records as of this slice
(27 pre-Slice-15 + 5 added by Slice 15 + 1 added by this slice), not 28. Section 2's tier-distribution table is
corrected below with a full recount against the table's own rows. No capability, row, or classification is
added or removed by this correction -- only the summary counts. See
`docs/research/THETA_WAVE_2_SLICE_18_QUALITY_CORRECTION_2026-09-22.md` for the full correction record.

Status: this is the standalone document `docs/research/THETA_PRE_VPS_AUDIT_SCOPE_AND_PLAN.md`
named as "still explicitly deferred" after Slice 14 -- "a dedicated
HARD_REQUIRED_SAFETY/REQUIRED_WHEN_APPLICABLE/ECONOMIC_RANKING_FEATURE/
OPTIONAL_RESEARCH_MODIFIER/EMPIRICAL_FEATURE matrix." `brokerAuthority: false`
throughout; this is classification and cross-reference work only, no
Production file touched.

## 0. Method and scope

Every row below is one entry from the real, machine-readable
`src/research/pre-vps-capability-registry.ts` (32 entries as of Slice 15's
reconciliation, corrected from a miscounted 27 -- see the correction note
above). No new capability is invented here -- this document adds one
new classification axis (the five-tier taxonomy) on top of the registry's
existing `maturity`/`firstPaperRequired`/`preVpsRequired`/`currentState`
fields, plus a terse "what breaks if this is wrong or missing" statement per
row, which the registry itself does not carry as a field.

**Tier definitions** (research judgment, not a TRD-defined taxonomy -- flagged
as such since the TRD does not name these five tiers explicitly):

- **HARD_REQUIRED_SAFETY**: a missing or wrong value here can produce an
  unsafe order, an unbounded loss, a silent-zero where UNKNOWN belongs, or a
  fail-open where fail-closed is required. Never acceptable to skip; the
  system must refuse to act (WAIT/HOLD_ONLY) rather than proceed on a guess.
- **REQUIRED_WHEN_APPLICABLE**: required for correctness whenever the
  relevant lifecycle branch is reached (e.g. corporate-action evidence only
  matters for names actually approaching an ex-date), but its absence for a
  branch that never triggers is not itself a safety violation.
- **ECONOMIC_RANKING_FEATURE**: affects which candidate is chosen among
  already-safe candidates (sizing, ranking, Pareto comparison) but a missing
  value degrades quality of decision, not safety of decision.
- **OPTIONAL_RESEARCH_MODIFIER**: research-only signal that may someday feed
  a Production ranking decision but currently does not; its absence changes
  nothing about what THETA does today.
- **EMPIRICAL_FEATURE**: exists purely to answer a research question (does a
  pattern replicate out-of-sample, is a threshold empirically supported) and
  is explicitly barred from being a live gating input by TRD ablation
  discipline until promoted through the versioned process.

## 1. The matrix

| capabilityId | Tier | preVpsRequired | currentState | What breaks if wrong/missing |
| --- | --- | --- | --- | --- |
| `MARKET_CLOCK` | HARD_REQUIRED_SAFETY | true | REAL | Acting on a closed/unknown session; every downstream decision timestamp becomes untrustworthy |
| `BROKER_ACCOUNT` | HARD_REQUIRED_SAFETY | true | REAL | Sizing against stale/wrong buying power -- direct capital-at-risk exposure |
| `BROKER_POSITIONS` | HARD_REQUIRED_SAFETY | true | REAL | Ownership/recovery/AEGIS exposure computed against a wrong position set -- could permit a new CSP on a name already carrying unrecognized risk |
| `BROKER_OPEN_ORDERS` | HARD_REQUIRED_SAFETY | true | REAL | Idempotency/reconciliation failure -- risk of duplicate order submission |
| `BROKER_ORDER_SUBMISSION` | HARD_REQUIRED_SAFETY | true | REAL | The sole real broker-mutation authority; any bypass of its gating is a direct live-order-safety violation |
| `BROKER_RECONCILIATION` | HARD_REQUIRED_SAFETY | true | NOT_INDEPENDENTLY_VERIFIED | Worker restart with silently divergent local-vs-broker state -- could double-act or miss a real fill |
| `UNIVERSE_DISCOVERY` | REQUIRED_WHEN_APPLICABLE | true | REAL | Scanning a stale/wrong tradable universe -- missed opportunity, not a safety breach per se (no position can be opened on a name that was never discovered) |
| `UNDERLYING_RANKING` | ECONOMIC_RANKING_FEATURE | true | PARTIAL | Sub-optimal scan-priority ordering; does not itself permit an unsafe trade |
| `OPTIONABILITY_CHECK` | HARD_REQUIRED_SAFETY | true | NOT_INDEPENDENTLY_VERIFIED | Attempting to route a strategy against a name with no real tradable chain -- likely fails downstream but the gate exists precisely to fail fast and safe |
| `OPTION_CONTRACT_DISCOVERY` | HARD_REQUIRED_SAFETY | true | REAL (blocker noted) | Building a candidate lattice from a wrong/incomplete contract set -- the CONTRACT_NOT_EXECUTABLE investigation is exactly this kind of concern |
| `EXECUTABLE_BBO` | HARD_REQUIRED_SAFETY | true | REAL | Pricing/sizing against stale or non-executable quotes -- the single most direct "quote freshness" safety gate |
| `CONTRACT_MULTIPLIER_MAPPING` | HARD_REQUIRED_SAFETY | true | NOT_INDEPENDENTLY_VERIFIED | A wrong multiplier silently misprices collateral/premium by the multiplier's ratio -- this is the highest-priority open registry blocker for exactly this reason |
| `DELTA_STRIKE_DTE_LATTICE` | HARD_REQUIRED_SAFETY | true | NOT_INDEPENDENTLY_VERIFIED | Malformed candidate generation upstream of every downstream safety gate |
| `CORPORATE_ACTION_EVIDENCE` | REQUIRED_WHEN_APPLICABLE | true | REAL | A name with an unrecognized split/dividend/M&A event could be mispriced or mis-managed at CC/call-away time; irrelevant for names with no pending action |
| `AEGIS_SECTOR_CORRELATION` | HARD_REQUIRED_SAFETY | true | PARTIAL | Concentration risk silently exceeded across correlated names -- the exact multi-position gap this registry already flags as open |
| `AEGIS_SYSTEM_STRESS` | HARD_REQUIRED_SAFETY | true | STUB_DEFAULT | Currently forces SYSTEM family to HOLD_ONLY every cycle (fail-closed, which is the safe direction) -- but see the separate D1 policy-authority-unresolved decision on whether this specific fail-closed behavior is the intended final state |
| `CROSS_STRATEGY_ECONOMIC_COMPARISON` | ECONOMIC_RANKING_FEATURE | true | PARTIAL | Sub-optimal candidate selection among safe candidates, not a safety breach (per registry: only one branch's candidates ever coexist today, so this is latent, not active) |
| `AEGIS_EVALUATION` | HARD_REQUIRED_SAFETY | true | PARTIAL | The candidate-specific hard-safety gate itself -- a defect here is a direct safety-rule failure |
| `SIZING_UNKNOWN_VS_EARNED_WAIT` | HARD_REQUIRED_SAFETY | true | REAL | Conflating an incomplete evaluation with a genuine WAIT decision would misrepresent risk posture and could mask a data-quality problem as a deliberate choice |
| `PAPER_PLAN_ASSEMBLY` | HARD_REQUIRED_SAFETY | true | REAL | The gate between a canonical decision and anything reaching Paper execution -- a defect here is a direct execution-safety concern |
| `ROLL_CC_CANDIDATE_VALUATION` | ECONOMIC_RANKING_FEATURE | true | STUB_DEFAULT | Real, tested valuation machinery -- its unreachability degrades management quality (ROLL/SELL_CC never fire) but does not itself introduce an unsafe action, since the machinery simply never runs |
| `ROLL_CC_CANDIDATE_SOURCE` | HARD_REQUIRED_SAFETY | true | STUB_DEFAULT | **Reclassified up from ECONOMIC_RANKING_FEATURE on reflection**: an always-null candidate source means THETA cannot roll or sell a covered call at all -- for a Wheel bot, being structurally unable to manage risk on an open position is itself a safety-adjacent gap (positions cannot be actively managed toward the intended lifecycle), not merely a quality-of-decision issue. This is the P0 confirmed unchanged across multiple prior slices. |
| `QUARANTINED_MANAGEMENT_ARCHITECTURE` | OPTIONAL_RESEARCH_MODIFIER (currently) | false | QUARANTINED_NO_CALLERS | Zero real callers -- correctly inert. Would become HARD_REQUIRED_SAFETY-adjacent immediately if ever adopted as a second live authority alongside the first, which is exactly the "never run alongside" rule this registry already states |
| `WHOLE_CHAIN_ACCOUNTING` | HARD_REQUIRED_SAFETY | true | REAL | Silent-zero fee/basis handling would misstate realized P&L -- directly violates the "missing data becomes UNKNOWN, never zero" non-negotiable rule |
| `DISASTER_RECOVERY_BACKUP_RESTORE` | HARD_REQUIRED_SAFETY | true | REAL (Codex WIP) | Unrecoverable state loss on a VPS relocation or outage -- financial-state safety, not just convenience |
| `CROSS_STRATEGY_RESEARCH_CONTRACT` | EMPIRICAL_FEATURE | false | REAL | Research-only by design; correctly not Production-integrated |
| `UNIVERSE_OPPORTUNITY_REGRET_SCHEMA` | EMPIRICAL_FEATURE | false | REAL (zero real rows) | Research-only; currently cannot even be exercised against real data (schema exists, no persisted rows found) |
| `EVENT_RISK_STATE` | REQUIRED_WHEN_APPLICABLE | true | PARTIAL | Only matters for names actually facing an event window; UNKNOWN handling is correct by design (pure tri-state helper), but whether real callers ever supply non-UNKNOWN was not re-derived this pass |
| `OWNERSHIP_CONTRACT` | HARD_REQUIRED_SAFETY | true | NOT_INDEPENDENTLY_VERIFIED | TRD CAND-003's ownability gate directly restricts which strikes/underlyings are acceptable -- a defect here could admit a candidate the TRD intends to exclude |
| `CORRELATION_EVIDENCE` | OPTIONAL_RESEARCH_MODIFIER | false | REAL | Research-only pairwise correlation; zero Production/AEGIS callers -- must not be mistaken for closing the real `AEGIS_SECTOR_CORRELATION` gap (see that row) |
| `HAR_RV_CONTRACT` | EMPIRICAL_FEATURE | false | REAL | Self-scoped research/shadow only, one consumer, no Production caller |
| `OPTIONOMICS_FEATURE_ENGINE` | ECONOMIC_RANKING_FEATURE (pending Codex confirmation) | true | NOT_INDEPENDENTLY_VERIFIED | If `options-chain-decision-intelligence.ts` turns out to be a live Production decision path rather than shadow-only, this tier should be revisited toward HARD_REQUIRED_SAFETY for the fields it feeds into hard gates (liquidity/executability-adjacent) -- flagged, not asserted, per the open Slice 15 question |
| `CORRELATION_WINDOW_STABILITY` | OPTIONAL_RESEARCH_MODIFIER | false | REAL | Added to the registry later in this same slice (this document was written before that addition landed); research-only, zero Production callers, degrades nothing if wrong since nothing consumes it yet |

## 2. Tier distribution

**Corrected (Wave 2 Slice 18):** the counts below were recounted directly against Section 1's own 33 rows;
the original version of this table summed to 28 (an arithmetic error carried over from the Slice 15
miscount), not the true row count. `OPTIONOMICS_FEATURE_ENGINE` is counted under `ECONOMIC_RANKING_FEATURE`
(its pending-Codex-confirmation status is a qualifier on that row, not a separate tier bucket).

| Tier | Count |
| --- | --- |
| HARD_REQUIRED_SAFETY | 20 |
| REQUIRED_WHEN_APPLICABLE | 3 |
| ECONOMIC_RANKING_FEATURE | 4 |
| OPTIONAL_RESEARCH_MODIFIER | 3 |
| EMPIRICAL_FEATURE | 3 |

Total: 33, matching the registry's current count exactly. `CORRELATION_WINDOW_STABILITY`
was added to the registry during this same slice, after the first 32 rows of
this matrix were drafted -- no other capability was added or dropped by this
document itself.

## 3. What this matrix changes and does not change

- **Changes**: nothing in `src/research/pre-vps-capability-registry.ts` or
  any Production file. This is a read-only classification layer.
- **One judgment call flagged for Codex review**: `ROLL_CC_CANDIDATE_SOURCE`
  is classified `HARD_REQUIRED_SAFETY` here rather than the more intuitive
  `ECONOMIC_RANKING_FEATURE`, on the reasoning that a Wheel bot structurally
  unable to roll or sell a covered call cannot execute its own stated
  lifecycle safety valve (rolling away from an adverse position). Codex may
  disagree -- this is presented as a reasoned position, not a unilateral
  reclassification of registry `maturity`/`preVpsRequired` fields themselves
  (those are untouched).
- **Coverage disclosure**: this matrix classifies exactly the 33 entries the
  registry currently holds (corrected from a miscounted 27/28 -- see the
  correction note at the top of this document). It inherits every registry entry's own
  `currentState`/`blocker` honesty; it does not re-verify any of them. Where
  a prior slice already marked a field `NOT_INDEPENDENTLY_VERIFIED`, this
  document repeats that status rather than upgrading it.

## 4. Agent handoff

**OWNER:** Claude (quant research + adversarial validation)
**TASK:** Pre-VPS Wave 2, Slice 17 -- required-vs-optional evidence matrix (the
item explicitly deferred after Slice 14/15)
**FILES CHANGED:** this document (new); no source file touched
**NEXT RECOMMENDED TASK:** Codex to confirm or reject the `ROLL_CC_CANDIDATE_SOURCE`
tier-reclassification reasoning in Section 3, and to resolve the
`OPTIONOMICS_FEATURE_ENGINE` shadow-vs-Production question already open from
Slice 15 (it gates this matrix's tier for that row too).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
