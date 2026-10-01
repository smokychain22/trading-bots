# THETA_TODAY_PROGRESS_20261001_DEEP_AUDIT (partial, evidence-first)

Measured read-only at ~2026-10-01T18:10Z against the Production DB and the control-root worker. Items marked
NOT_AUDITED_THIS_PASS were not examined; they are not claimed as passing.

## Identity (verified)
main = origin/main = deployed = worker release = `c3d8868265426d870e50352b06d8d252c68a16c9`; exact-main CI run
36893883884 = success. Worker ONLINE, health fresh (85 s), SHA-aligned, 1 supervisor, execution gate LOCKED.
Host power: AC connected, battery 41% (earlier 75% on battery; now charging).
Command-5A health: 13,008 unresolved jobs, oldest overdue 79,679 s (pre-existing backlog), 62 maturation pending;
local research Parquet state DEFERRED_MARKET_CRITICAL (deferred, not zero). Fresh-subject priority NOT verified here.

## Session funnel (natural cycles 13:32Z-18:06Z, research.theta_runtime_behavior_diagnostic)
- Cycles: 47, all RISK_WAIT / SYSTEM_HOLD. Selected = 0. Candidate rows (sum over cycles) 52,008; feasible 4,943.
- Universe per cycle = 3 underlyings (IYM, KORU, SPY).
- Hard-gate totals: NOT_EVALUATED_SHORTLIST_BOUND 46,748 (by design: only finalists go to Q);
  AEGIS_HARD_VETO 128; Q_ACTION_INFEASIBLE 112; NOT_SENT_UPSTREAM_REJECT:CONTRACT_NOT_EXECUTABLE 77;
  VOLUME_BELOW_FLOOR 74; NO_ASSIGNMENT_CAPACITY 47; OPEN_INTEREST_BELOW_FLOOR 17;
  OWNERSHIP_ACCEPTABILITY_UNKNOWN 13; DELTA_OUTSIDE_ALL_BANDS 5; OPEN_INTEREST_UNKNOWN 3.
- Sizing binding: AEGIS_UNKNOWN 51,880 (= AEGIS not reached), UNDERLYING:UNDERLYING_SEVERELY_EXCEEDED 128
  (AEGIS reached), ROUTER_NOT_APPLICABLE 130,131 (non-Q branches).

## Reconciled contradictions
- SPY veto vs "AEGIS not run": not a contradiction. AEGIS ran candidate-specifically on Q-shortlisted SPY puts in
  all 47 cycles (e.g. cycle a0d7661f..., SPY261106P00715000; cycle a7905284..., SPY261030P00723000) and returned
  HARD_VETO via the UNDERLYING family (`bots/theta/quant/models/aegis.py` `_threshold_assessment`: ticker
  concentration >= soft cap x hard multiplier). One SPY cash-secured put (~$70k collateral) exceeds the per-ticker
  concentration cap on the paper account: a truthful capital-fit veto. The remaining 51,880 sizing rows are
  `AEGIS_UNKNOWN` = not reached; the label conflates "not reached" with "unavailable" (deferred diagnostic fix).
- KORU ownership UNKNOWN: required Q input (TRD UNIV-003; `theta_q_baseline.py` `_ownership_evaluation`, produced at
  `postgres-theta-cycle-store.ts:160`, value `orchestration.ownership.ownability`). Appears 13 times, KORU only.
  CORRECTION: it is not KORU-specific. In all 152 ownership evaluations in today's decision receipts, 4 of 5
  components are UNKNOWN (Liquidity, Structural, Recovery, EventAdjustment) and `ownability` is null for every
  underlying, including SPY. The count of 13 only reflects which candidates reached that Q reason first.

## Q diagnosis (what the data supports)
Dominant finalist-stage blockers are liquidity floors (volume 74, open interest 17+3) and contract executability (77),
not optional data. This points to a liquidity BOOTSTRAP_POLICY / market-suitability question, which is a calibration
research question. Sensitivity runs around volume/OI floors were NOT done; no Production threshold changed. Whether Q
is "too strict" is UNPROVEN either way.

## Maturity scorecard (current-release evidence only)
| Subsystem | Status |
|---|---|
| Database / schema / worker / supervisor | WORKING_CURRENT_RELEASE |
| Alpaca reconciliation / execution gate lock | WORKING_CURRENT_RELEASE |
| Contract enumeration, features, router, Q, AEGIS | PARTIALLY_REACHED (AEGIS only on shortlisted candidates) |
| H / D | RESEARCH_ONLY (not re-audited) |
| A / C | NOT_APPLICABLE on flat account (CC route reason NO_CONFIRMED_STOCK) |
| Sizing | PARTIALLY_REACHED (only where AEGIS ran; all qty 0) |
| Entry selection, execution, idempotency, profit/loss/roll/assignment/recovery management | WORKING_SOURCE_ONLY (no live position yet) |
| Paper autonomy transition | WORKING_SOURCE_ONLY (unit + real-DB test + CI; never exercised live) |
| Whole-chain accounting, replay, WAIT T0/archive, counterfactual learning | NOT_AUDITED_THIS_PASS |
| Command-5A | PARTIALLY_REACHED (large old backlog; fresh-subject priority unverified live) |
| Models, profitability, copy-trading, security sweep | EMPIRICALLY_UNPROVEN / NOT_AUDITED_THIS_PASS |

## Not done in this pass (explicit)
WAIT T0 capture and provider-free replay with tamper test; per-cycle latency/memory percentiles; 32-method/21-layer
and 20-feature-family recount; single-authority symbol census; old-incident regression matrix (41 items);
Q sensitivity runs; UNKNOWN taxonomy counts; FALSE_ZERO/FALSE_FALSE/FALSE_CLEAR source sweep; security sweep of
today's diffs. Counts for these are NOT reported (not zero).

## Paper canary
No Q-qualifying candidate in 47 natural cycles; canary not armed; ORDER_SUBMISSIONS=0; BROKER_MUTATIONS=0.
Live not ready. Profitability: INSUFFICIENT_EVIDENCE (0 Paper trades).

## ROOT CAUSE FINDING: Q is structurally unable to trade under the current Paper policy (evidence below)
1. Paper bootstrap (`src/theta/paper-entry-bootstrap.ts`, v3) accepts only EventAdjustment and RecoveryQuality as
   UNKNOWN ownership components. Any other unknown component -> `BOOTSTRAP_UNKNOWN_COMPONENT_SET_NOT_ALLOWED`.
2. StructuralQuality needs `relativeStrength`. `theta-shadow-cycle.ts:1969` supplies it (value 0, identity vs SPY)
   ONLY for instruments in the owner-approved manifest `paperInstrumentClassificationManifest`
   (`paper-entry-safety-policy.ts:27`), which contains exactly ONE entry: SPY. Every other underlying (IYM, KORU,
   ZSL...) gets `relativeStrength=null` -> StructuralQuality UNKNOWN -> bootstrap-ineligible.
3. SPY itself is the only bootstrap-eligible name, and AEGIS vetoes its minimum executable unit (one CSP ~ $70k
   collateral) on ticker concentration (state STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE semantics,
   `strategy-account-policy-compatibility.ts`: minimum unit >= soft cap x hardCapMultiplier).
Conclusion: with the current manifest + account size + concentration policy, NO policy-compliant CSP can reach
sizing > 0 on any approved underlying. This is a policy/config/account-fit fact, not a code defect and not a market
verdict. It cannot be changed autonomously: widening the manifest needs owner-approved issuer evidence for each
instrument, and changing concentration caps or account capital is a risk-policy change. Not changed.
Owner decision needed: (a) approve additional lower-priced optionable instruments with authority refs, and/or
(b) change paper account capital / concentration policy. Neither was done.

## Universe (why 3 underlyings)
Discovery funnel (latest cycle): 101 assets (`CLIENT_ASSET_BOUND_REACHED`, assetsTruncatedByBound=true) -> 100 after
exchange filter -> 72 with usable bars -> 10 optionability checks -> 9 optionable. Scan champions SPY, KORU, one
challenger (ZSL) with maximumAdditionalFullScans=1. Narrow by design (bounded scan); the 101-asset client bound is a
possible truncation risk for universe breadth and is queued for review (not changed today).

## ACCOUNT FIT (measured, read-only GET of Alpaca Paper account)
status ACTIVE; equity 99,999.96; cash 99,999.96; options buying power 99,999.96; stock buying power 399,999.84;
long market value 0; options level 3. Policy (`paper-bootstrap-runtime-policy.ts`, aegis block): ticker concentration
cap 15% of equity, hard veto at cap x 1.5 = 22.5%.
- Per-underlying soft cap = $15,000; hard veto threshold = $22,499.99.
- CSP collateral = strike x 100 (single multiplier; SPY261106P00715000 -> 715 x 100 = 71,500 = 71.5% of equity,
  3.2x the hard threshold). No unit error: dollars, decimal fraction, one 100x multiplier.
- A put can pass hard veto only if strike <= $224.99; full size only if strike <= $149.99. SPY trades near $715, so
  a compliant SPY put would need a strike ~69% out of the money (premium/liquidity effectively zero).
  CAN_ANY_SPY_CONTRACT_FIT = NO (bound proof; exact listed-strike min not enumerated).
- Instruments that WOULD fit by capital: share price below ~$225 (IYM, KORU, ZSL class), but they fail the bootstrap
  manifest gate (see root cause). Hence ACCOUNT_UNIVERSE_COMPATIBILITY = INCOMPATIBLE for Q Paper entries today.
- Semantics: AEGIS `_threshold_assessment` defines value >= soft x hardMultiplier as HARD_VETO. The repo already has
  a distinct class `STRATEGY_ACCOUNT_POLICY_INCOMPATIBLE` (strategy-account-policy-compatibility.ts); sizing is 0
  either way, risk protection is identical. Surfacing that class in the runtime diagnostic is a P2 diagnostic item.

## Universe pipeline defect (code-solvable, real)
`fetchTradableAssets` (alpaca-provider.ts:378) downloads the FULL /v2/assets list, then `tradableOnly.slice(0,
maxAssets)` runs BEFORE liquidity ranking. Production passes maxCandidateAssets=100 (production-shadow-runtime.ts:307,
database-independent-shadow-observation.ts:212; the one-shot tool uses 500). The "best universe" is therefore the
first ~100 tradable assets in provider order plus pinned requiredSymbols (SPY/KORU champions), not a ranked set.
Exchange filtering also happens after the bound. Fix design (post-close, needs a governed release): apply the
exchange filter before bounding and rotate a deterministic window across cycles, or rank on a cheap pre-signal.
Not wired today: bars cost scales with asset count, and widening the universe has no effect until the instrument
gate below is resolved.

## Circular instrument gate (architecture finding)
`relativeStrength` is never computed from data. `theta-shadow-cycle.ts:1969` hard-assigns identity 0 only when the
instrument is a manifest-approved NON_COMPANY_FUND, otherwise null. Chain: not in manifest -> relativeStrength null ->
StructuralQuality UNKNOWN -> bootstrap unknown-set not allowed -> never Q-eligible -> never accumulates Paper
evidence -> never promotable. Additionally the manifest classification drives company-event applicability, so
fixing relative strength alone would not make a non-manifest symbol tradable.

## INSTRUMENT_PROMOTION_CONTRACT (proposal for owner review; nothing enabled)
To add an instrument to `paperInstrumentClassificationManifest` require, each as a versioned, source-controlled item:
1. Identity: ticker, asset class, exchange, Alpaca tradable+optionable (listed puts present, standard deliverable).
2. Classification authority: official issuer/exchange document hash (NON_COMPANY_FUND vs OPERATING_COMPANY) with
   effectiveAt/reviewedAt, as for SPY. Operating companies additionally need positive earnings-date evidence.
3. Structural quality: a computed, point-in-time relative-strength feature (benchmark SPY, defined window and scale)
   so StructuralQuality is known without hard-coding identity 0; scale/winsorization declared as policy.
4. Product-risk review: leveraged/inverse/volatility products (e.g. KORU 3x, ZSL -2x) need an explicit policy
   because path decay, gap risk and assignment into a decaying product break the Wheel assumptions. Not
   recommended without that review.
5. Liquidity evidence: option OI/volume/spread distribution over a defined lookback meeting the Q floors.
6. Capital fit: minimum-compliant collateral < per-underlying hard cap at current equity (strike x 100 < $22.5k).
7. Event policy: macro/corporate-action coverage state CLEAR-able, not UNKNOWN.
Status: DEFER_OWNER_POLICY. Cheap collateral alone is not a reason to approve.

## WAIT replay / archive (executed, current release real data)
Cycle `a1855957-adf6-45ba-9157-b51bbbca5682` (decision 2026-10-01T18:43:39Z, SYSTEM_HOLD, source c3d8868): captured
read-only from `trade.fusion_snapshot` (238,587-byte gzip archive, sha256 d80a2a5b...). `--historical` provider-free
replay from the immutable release worktree: state SAME_SOURCE_REPRODUCED, frontier hash 7c1f6c4e... identical,
action SYSTEM_HOLD, selected=null, 62 input contracts, providerRequests=0, brokerMutations=0, 6 methods executed
all real-input-eligible. Negative control: one byte flipped in a copy of the archive -> replay threw (rejected);
temporary tamper files removed. Conclusion: WAIT decisions DO support archive capture + replay (no trade needed).

## Census results (read-only agents, spot-verified where noted)
- Security sweep: 660 files (last 60 commits + docs/), SECRET_FINDINGS=0, PRIVATE_DATA_FINDINGS=0; .env* ignored,
  only .env.example tracked with empty credential values. Advisory: CI Postgres password is plain text in ci.yml on
  loopback service container (throwaway). 64-hex strings are hashes by context (not each verified).
- Broker mutation authority: single. Only `AlpacaPaperBrokerAdapter` (broker.ts:320/325/330) sends order
  POST/PATCH/DELETE, and only `PaperOrderCoordinator` calls it. Guard test `phase5-authority-structure` greps only
  5 files (gap D6: should scan all of src/).
- Entry selection: `buildCanonicalStrategyFrontier` is canonical. Residual duplicate producers (subordinate, quantity/
  candidate overridden by frontier): `decision-assembly.ts` winner, Python `compute_sizing`, cross-symbol frontier
  `researchPick`. Management selection has no structural guard test (gap D5). AEGIS has multiple input writers
  (local-aegis-risk-history, candidateStressAegisOverrides); must be verified tighten-only (open).
- False-value sweep (grep-based, ~78 TS + ~12 PY hits): no unsafe default in the live trade path. Verified:
  `common-horizon-economics.ts:73` treats a null leg as 0, but its only roll caller (`roll-incremental-utility.ts:91`)
  rejects either null leg first -> guarded, latent API hazard only. Unverified/low: `theta-shadow-cycle.ts:1107`
  eventLookaheadDays `?? 0`; research-only Python `t0_bundle_adapter.py:68`, `flow.py:76`, `fill_probability_baseline
  .py:73,100`, `theta_q_baseline.py:447` (ownership_score or 0.0 in sort key). Limits: ternary/destructuring
  defaults not swept.

## Command-5A / observation pipeline (measured; REAL current-release defect found and fixed in source)
Postgres `research.theta_execution_observation_job` today: 1,808 jobs created; 74 MISSED (HOST_OFFLINE, pre-cutover
host downtime), 1,226 PENDING with target already passed (190 s to 5.2 h overdue), 508 PENDING future, **0 OBSERVED
today** (last OBSERVED ever: 2026-09-18; 150 total vs 140,971 MISSED). Old backlog: 13,230 PENDING overdue; the worker
closes ~500/h of them as MISSED (`OBSERVATION_MISSED_NO_ACTIVE_WORKER`, 3,500 today, avg lag ~6.8 days).
Root cause: `processDueExecutionObservations` (production-shadow-runtime.ts, called from autonomous-runtime
MARKET_STATE_REFRESH) selected `ORDER BY target_at LIMIT 50` (oldest first) and only observes jobs within 120 s of
target. The 13k-job unrecoverable backlog therefore starved every fresh job past its window. The earlier "fresh
priority" fix (e228baf) covered the separate local SQLite Command-5A scheduler, not this Postgres path.
Fix (commit pending, not deployed): still-observable jobs sort first (`target_at > now - 120 s` DESC), backlog still
drains at 50/tick as explicit MISSED; window constant shared; regression test `tests/due-observation-priority.test.ts`;
SQL validated read-only on the real schema. Caveat: whether tick cadence is short enough to land inside the 120 s
window for 1M/5M targets is UNVERIFIED; the fix removes starvation but cannot create marks for jobs whose tick comes
later than 120 s after target. Deploy needs the governed release path (CI + evidence regeneration), post-close.

## Source fixes on branch claude/theta-codex-continuation-20261001 (local, unpushed, undeployed)
1. 03b8324 AEGIS_NOT_REACHED_UPSTREAM label (diagnostic truth; same fail-closed behavior).
2. Fresh-first Postgres observation ordering (above).
Both need: full Node/Python/browser/Windows/DB validation, governed evidence regeneration (touched hash-bound files),
exact-SHA CI, then one governed cutover after market close. Not done yet.

## ENGINEERING PASS 2 (measured; commits c84b3db onward on claude/theta-codex-continuation-20261001)

### SPY capital fit, exact (archived cycle e9f4b10f, source c3d8868, 2,619 enumerated SPY puts, DTE 4-60)
Equity 99,999.96; ticker cap 15% ($15,000); hard veto at x1.5 ($22,499.99). Collateral = strike x 100 (single multiplier;
SPY261120P00706000 -> 706 x 100 = $70,600). Cheapest enumerated put: strike $300 -> $30,000 (30.0% of equity, bid 0.02,
delta -0.0014, economically void). MIN / MEDIAN / MAX collateral = $30,000 / $75,200 / $100,000.
CAN_ANY_SPY_PUT_FIT_CURRENT_POLICY = NO (proved on the full enumerated chain). Classification: ACCOUNT_POLICY_INCOMPATIBILITY.
Equity needed for the cheapest Q-valid SPY put ($37,500, strike 375) to clear the hard threshold: >= $166,667; full size: >= $250,000.

### Q sensitivity (offline, same corpus, Production untouched)
Gate funnel at baseline (DTE 25-60, |delta|<=0.5, OI>=50, volume>=10, bid and ask>0, spread<=15%, quote age<=30 s):
2,619 -> 961 (DTE) -> 643 (delta) -> 550 (OI) -> 392 (volume) -> 392 (two-sided quote) -> 363 (spread) -> 363 (age).
363 SPY puts pass every liquidity/structural gate. Perturbing OI 10..100, volume 1..20, spread 10%..50%, age 15..120 s,
delta 0.35..0.8, DTE 7..30 keeps the qualifying count between 252 and 666. Relaxing ALL liquidity gates: 639 qualify, 0 fit capital.
Equity scenarios (liquidity baseline): x1.25 -> 0 fit the hard threshold; x1.5 -> 0; x2 -> 6; x3 -> 99 (6 full size); x4.7 -> 363 (152 full size).
VERDICT: SPY inactivity is ACCOUNT_SCALE (collateral vs concentration cap), not Q liquidity strictness (Q_TOO_STRICT = NO).
Non-SPY symbols are blocked by the instrument manifest (policy), not by liquidity.

### Universe ranking: real defect, fixed in source (c84b3db)
Alpaca /v2/assets returned 13,515 tradable assets (12,916 on NYSE/NASDAQ/ARCA/BATS) in ARBITRARY order (KORU is #2) and
discovery bounded to the first 100 BEFORE ranking: a 0.7% arbitrary sample; SPY/KORU survived only as pinned requiredSymbols.
Fix: full list -> exchange filter -> multi-symbol snapshot sweep (33 calls, 0 failures, 3.4 s live) -> rank by prior-day dollar
volume -> bound 100 -> bars/optionability. Live check: SPY rank 1, NVDA 2, AAPL 5, IWM 8; 56 of the top 100 have collateral
below $22.5k per contract. KORU ranks 944 and IYM 3,722 (IEX volume), so they leave the discovered 100 unless pinned.
Regression fixtures at 99/100/101/500/1000, order independence, outage degradation (visible blocker), required-symbol retention.
Approved-instrument policy untouched (SPY only), so Paper Q behavior is unchanged; research breadth improves.

### Ownership components (evidence: 152 decision receipts; SPY receipt inspected field by field)
LiquidityQuality: stock avg volume + option OI + option volume + spread. The underlying-level assessment has no option inputs
-> UNKNOWN by design; the candidate-level assessment supplies them. REQUIRED by Q bootstrap.
StructuralQuality: MA20/50/200 rel, MA slope, relativeStrength. relativeStrength is supplied (value 0, identity) ONLY for
manifest-approved funds (theta-shadow-cycle.ts:1969) -> UNKNOWN for every other symbol. REQUIRED by Q bootstrap.
RecoveryQuality: needs a historical recovery-duration model ("real recovery model not yet fit") -> UNKNOWN for all.
ALLOWED unknown in Paper bootstrap. TailQuality: proxy, known for all; REQUIRED. EventAdjustment: event-distance inputs are
hard-null in the production path -> UNKNOWN for all; ALLOWED unknown (event safety is governed by CompanyEventPaperPolicy).
Q intentionally requires ownership suitability because a CSP can end in assignment (UNIV-003). Minimum bootstrap evidence =
Liquidity + Structural + Tail known; Recovery/Event may be unknown.
CIRCULAR DEPENDENCY CONFIRMED: not in manifest -> no relativeStrength -> StructuralQuality UNKNOWN -> bootstrap-ineligible ->
no Paper evidence -> never promotable. Proper separation (DEFER_OWNER_POLICY, not implemented): compute relativeStrength from
point-in-time bars vs a declared benchmark/window/scale for ANY symbol (ranking evidence), with approval remaining a separate
manifest decision.

### Command-5A cadence (measured; the fix is infrastructure and is deferred)
Full worker cycle period (51 gaps): avg 349 s, p50 284 s, p95 360 s, min 119 s. The Postgres observation step runs once per
cycle. Job target offsets from job creation: 1M -24..+34 s, 5M 216..274 s, 30M 1716..1774 s, EOD 3369..23216 s. Window = 120 s.
The next tick after job creation is roughly one cycle later (~250-350 s): 1M RELIABLE=NO (lag ~220-380 s, structurally
unreachable); 5M RELIABLE=NO (phase dependent, at best ~120/349 = 34%); 30M RELIABLE=NO (~34%).
The fresh-first ordering fix (2e5af4b) removes starvation but cannot create sub-cycle timing. A real fix needs a dedicated
marks-only tick (<= 30 s) that is lease-safe against the main cycle; not implemented because the Windows supervisor serialises
requests under the request lease. Top infra item for the next governed release.

### Validation state (branch head cda96d1; CI run 36913155268 pending when written)
Local: Node 3,393 tests / 3,376 pass / 0 fail / 17 DB-gated skips; Python 1,267 OK; lint 0; build OK; security scan 1,876 paths
0 findings; storage policy PASS; 4 Windows PowerShell tests PASS; 23 browser tests PASS.
Phases 2-6 executed-test evidence was regenerated through the governed generators (no hand edits); Phase 2 requirement 2.4
(disposable-DB bound) still needs the exact-SHA CI import after CI is green.
New regression/guard tests: AEGIS not-reached label; fresh-first observation order; universe ranking (99/100/101/500/1000);
covered-call share boundary (0/99/100/101/199/200/250); roll missing-leg typed result; whole-repo authority guards (order mutation,
coordinator construction, management and entry selectors, sizing, max(1)); order-intent transition invariants (CANCEL_REQUESTED);
DB-level clientOrderId uniqueness.
Authority census: ENTRY = buildCanonicalStrategyFrontier (1 implementation); MANAGEMENT = buildManagementActionFrontier (1
implementation, 3 declared callers); SIZING = structuralSizing (1); BROKER MUTATION = PaperOrderCoordinator -> AlpacaPaperBrokerAdapter
(1 call-site file, 1 HTTP-mutation file); AEGIS = Python assess_aegis (policy math) with TS adapters.
Brain: 21 layers defined, 18 reachable (0-17), layers 18-20 research/readiness. 32 registry methods: 16 PRODUCTION-locked,
3 SHADOW, 13 RESEARCH_ONLY; 3 are contract-only/unconsumed (ADAPTIVE_ECONOMIC_STRATEGY_SWITCHING, ENTRY_PROFITABILITY_MODEL,
MANAGED_EPISODE_DISTRIBUTION_MODEL); WHOLE_CHAIN_ACCOUNTING is labelled PRODUCTION L6 but no worker import path was found (verify).
Features: 20 canonical families (TS enum == Python CANONICAL_FAMILIES); about 4 reach Production decisions; 13 research-only;
2 blocked (SECTOR, FUNDAMENTAL_QUALITY: no provider). Training-serving skew: realized volatility (TS population variance vs Python
n-1, ~2.6% at N=20), trend slope (OLS/mean vs SMA difference), max adverse gap (no Python producer). OWNERSHIP/REGIME are
registered with version "pre-existing".
Old incidents: 54 catalogued, 49 with an existing regression test, 5 without (2 documentation-only, 3 unverified: A/C false
credit, THETA-O CC/roll tier, THETA-Q2 invariant 008); none observed to recur in the 13:32-18:43Z session.
