# THETA pre-VPS acceptance contract

Status: Slice 13 of the pre-VPS master continuation directive. Every gate
below links to the exact capability/evidence this engagement has (or has
not) confirmed. Research-only strategy promotion is **not** required for the
first Conventional Paper trade -- but every `PRODUCTION_REQUIRED` capability
below must be operational. A gate marked `NOT MET` blocks VPS relocation
until closed; a gate marked `MET` names the exact evidence.

| Gate | Status | Evidence |
| --- | --- | --- |
| `DATABASE_WRITABLE` | **NOT YET PASS** | Per the real 2026-09-21 forensic, Aiven showed `default_transaction_read_only=on`. As of `main@0aa1aef` (2026-09-22, "docs(dr): record verified Aiven format-v2 recovery point"), the DR doc confirms real, extensive BACKUP/RESTORE verification but does **not** state live Aiven write availability has been restored -- per the directive's own instruction, this ledger does NOT infer Aiven-writable merely because restore passed. Codex-owned; no Aiven access from this research branch to independently re-verify. |
| `DATABASE_PORTABLE_BACKUP_VERIFIED` | **PASS, confirmed against current main** | `main@0aa1aef`: 5 full production backups verified; structure fingerprint match (`9421fe65...` on both source and target); all-table row counts, sequence state, and 13 critical-table content digests pass parity; 2 customer identities, 2 encrypted broker credentials, 25,126 legacy artifacts, and 1,244 external-asset files verified byte-for-byte |
| `DATABASE_TEST_RESTORE_VERIFIED` | **PASS, confirmed against current main** | Same commit: "A separate PostgreSQL 18 database restored 12 schemas, 153 base/partitioned tables, 2,808 constraints, 395 indexes, 17 sequences, five views, 46 routines, 112 user triggers, 15 custom types, two extensions, and migration `064_alpaca_corporate_action_observation`" |
| `STRUCTURE_PARITY` (new gate, per this pass's directive) | **PASS, confirmed against current main** | Same commit: source and restored structure fingerprints both equal `9421fe659efd8ea4dbf8648b690436e6b14058015f9f11a70c93064934718dc2` |
| `DATA_PARITY` (new gate, per this pass's directive) | **PASS, confirmed against current main** | Same commit: row counts, sequence state, and all 13 critical-table content digests passed; a real timezone-rendering digest bug (`PGTZ` not pinned to UTC) was found and fixed first, and the fix is what makes this parity claim trustworthy rather than coincidental |
| `CURRENT_WORKER_SHA_KNOWN` | **MET** | Per the R7 forensic: pinned worker SHA `853beb4fde989c2f6deb83ad9cb13a9a3e87e76a`, confirmed running at forensic time |
| `BROKER_RECONCILIATION_HEALTHY` | **NOT INDEPENDENTLY VERIFIED** | `broker-reconciliation-worker.ts` confirmed to exist; internals not read this pass |
| `ALPACA_CLOCK_REAL` | **MET** | `fetchMarketClock`, real endpoint, confirmed via source read |
| `ALPACA_ACCOUNT_REAL` | **MET** | `fetchMasterAccountSnapshot`, real endpoint |
| `ALPACA_POSITIONS_REAL` | **MET** | `fetchPositions`, real endpoint |
| `ALPACA_QUOTES_REAL` | **MET** | `fetchLatestStockQuote`/`fetchOptionSnapshots`, real endpoints, confirmed real in the R7 forensic (1,696 distinct contracts fetched in one session) |
| `OPTIONOMICS_REQUIRED_FIELDS_REAL` | **PARTIAL** | `atm_iv`/`iv_rank`/`iv_percentile`/`iv30`/`rv20`/`iv_minus_rv20`/`skew`/`term_structure`/`max_pain` confirmed QUALIFIED via real MCP calls this pass; `expected_move` NOT_OBSERVED; `rv5`/`rv10`/`rv30`/`rv60` PROVIDER_LIMITED; `call_wall`/`put_wall` QUARANTINED |
| `EVENT_REQUIRED_FIELDS_GOVERNED` | **NOT INDEPENDENTLY RE-VERIFIED this pass** | Prior-session work exists (`docs(theta): keep event unknown register aligned with observed evidence`, on `main`); not re-traced this pass |
| `CORPORATE_ACTION_REQUIRED_FIELDS_GOVERNED` | **MET** | `alpaca-corporate-action-evidence.ts` confirmed real, persisted (`main` commit history) |
| `UNIVERSE_REAL` | **MET** | `discoverRealUniverse`, real, confirmed via source read and the R7 forensic (75 real underlying evaluations) |
| `OPTIONABILITY_REAL` | **NOT INDEPENDENTLY VERIFIED this pass** | `universe-policy.ts` confirmed to exist; internals not re-read |
| `ROUTER_REAL` | **PARTIAL** | Real Python-bridge router exists and is invoked, but the TS caller only consumes `THETA_Q` eligibility -- see `THETA_STRATEGY_ROUTER_TRUTH_MATRIX.md` |
| `CONTRACT_SEARCH_REAL` / `DTE_SEARCH_REAL` / `STRIKE_SEARCH_REAL` | **MET for THETA_Q; NOT MET for Hold-Strike/Defined-Risk** | `theta_q_lattice.py` real; zero candidate generation exists for the other two branches |
| `QUOTE_FRESHNESS_REAL` | **MET (gate is real and root cause is RESOLVED); policy calibration remains open** | See `THETA_CONTRACT_NOT_EXECUTABLE_INVESTIGATION.md` -- Codex's own real-data query resolved the 3,299/3,876 breakdown (2,014 quote-stale+spread-wide, 787 spread-wide, 498 quote-stale). `OBSERVED_REJECTION_CAUSE_KNOWN = YES`. `POLICY_CORRECTNESS_NOT_YET_PROVEN` remains a separate, open Codex/owner calibration question -- the observed rejection rate alone does not prove the 30s/spread thresholds need to change, per Codex's own stated position. |
| `AEGIS_NO_AVOIDABLE_UNKNOWN` | **NOT MET -- CRITICAL, verified line-by-line, wording corrected this wave** | Direct read of `bots/theta/quant/models/aegis.py` confirms: `_liquidity()` returns `HOLD_ONLY` whenever `stress_spread_widening_detected is None`; `_system()` returns `HOLD_ONLY` whenever ANY of its 3 stress inputs is `None`. Both are confirmed always `None` in Production. `assess_aegis()`'s worst-family-wins fold means `new_risk_state` would be `HOLD_ONLY` or worse **for any candidate that reaches AEGIS evaluation** -- `_NEW_RISK_ACTIONS_BY_STATE[HOLD_ONLY] = frozenset()`. **Precise wording per Codex's own real evidence receipt** (`docs/operations/THETA_PRODUCTION_CLOSURE_WAVE1_2026-09-22.md`): do NOT claim "all 3,876 candidates were rejected by AEGIS" -- all 3,876 persisted rows have `aegis_json.state = null`, meaning `AEGIS_NOT_EVALUATED`/`NOT_PERSISTED` for that funnel (they were rejected upstream, overwhelmingly by `CONTRACT_NOT_EXECUTABLE`, before reaching AEGIS). The correct claim is: `CURRENT_PRODUCTION_INPUT_CONTRACT_DETERMINISTICALLY_BLOCKS_NEW_RISK IF/WHEN AEGIS IS EVALUATED WITH THESE CURRENT NULL SUPPLIERS` -- a deterministic code-path fact, not yet independently observed end-to-end in a real session because candidates haven't survived long enough to exercise it. Both facts stand together: the code-path block is proven; a real session hitting it is not yet observed. This remains `P0_FIRST_PAPER_BLOCKER` regardless -- once upstream filters are addressed, the present supplier contract would fail closed immediately. |
| `SIZING_CAN_BE_POSITIVE` | **STRUCTURALLY YES, EMPIRICALLY NOT YET OBSERVED** | Real sizing mechanism exists and the `sizingEvidenceUnknown`/`GLOBAL_WAIT` vs. `SYSTEM_HOLD` distinction is correctly implemented on `main`; the only real session available (2026-09-21) recorded 0 candidates with positive quantity, entirely explained by upstream rejection (`CONTRACT_NOT_EXECUTABLE` dominant), not by a sizing defect |
| `CANONICAL_DECISION_REAL` | **PARTIAL** | Within-branch real; cross-branch economic comparison does not exist (currently latent, not actively broken, since only one branch's candidates ever coexist) |
| `PAPER_PLAN_REAL` | **MET** | `master-paper-plan-assembly.ts:60`, real SHADOW gate, correctly scopes 3 of 5 branches |
| `ONE_MUTATION_OWNER` | **MET** | `src/execution/broker.ts`, real, gated, confirmed the sole real order-submission path; the competing `management-cycle.ts` architecture is confirmed QUARANTINED with zero real callers |
| `MANAGEMENT_CANDIDATES_REAL` | **NOT MET** | ROLL/ROLL_CC/SELL_CC have zero real candidate source -- **the single largest gate failure in this contract** |
| `CLOSE_REAL` | **MET** | Real, reachable |
| `ROLL_REAL` | **NOT MET** | Blocked by `MANAGEMENT_CANDIDATES_REAL` |
| `ASSIGNMENT_REAL` | **MET (structural)** | Real, reachable, deliberately non-economically-optimized by design |
| `RECOVERY_REAL` | **MET** | Real, reachable |
| `CC_REAL` | **NOT MET (for SELL_CC/ROLL_CC); MET for HOLD_CC/CLOSE_CC** | Same candidate-source gap |
| `CALL_AWAY_REAL` | **MET (structural)** | Real, reachable, deliberately non-economically-optimized by design |
| `WHOLE_CHAIN_REAL` | **MET** | Real fee/stock-basis UNKNOWN-vs-zero discipline confirmed |
| `RESTART_RECONCILIATION_REAL` | **NOT INDEPENDENTLY VERIFIED** | Not traced this pass |
| `REAL_PROVIDER_NO_SUBMIT_PASS` | **NOT ATTEMPTED this pass** | This research branch has no broker authority and has not attempted a live no-submit dry run; that proof belongs to Codex |
| `LOCKED_WORKER_OBSERVATION_PASS` | **PARTIAL EVIDENCE EXISTS** | The 2026-09-21 forensic IS a real locked-worker observation window, but it ended in a database outage before a full clean cycle completed |

## Overall verdict

**NOT MET.** `AEGIS_NO_AVOIDABLE_UNKNOWN` remains **the single most severe
gate failure in this entire contract** -- the current input contract would
deterministically block every new-risk-opening action the moment a
candidate reaches AEGIS evaluation, independent of `CONTRACT_NOT_EXECUTABLE`
and independent of `MANAGEMENT_CANDIDATES_REAL` (see the precise, wave-4-
corrected wording above: this is a proven code-path fact, not yet an
observed real-session fact, since no real candidate has survived long
enough to reach AEGIS in the one session examined). Even if
`CONTRACT_NOT_EXECUTABLE` and `MANAGEMENT_CANDIDATES_REAL` were both fixed
today, THETA would still open zero new positions once candidates started
reaching AEGIS. `MANAGEMENT_CANDIDATES_REAL` (ROLL/ROLL_CC/SELL_CC blocked)
remains a second, independent disqualifying gate for the management side.
`QUOTE_FRESHNESS_REAL`'s root cause is now RESOLVED (Wave 4); its policy
CALIBRATION remains a separate open question that does not block this gate
from reading MET, but does mean `SIZING_CAN_BE_POSITIVE` cannot yet be
observed at scale until Codex/owner settles that calibration.

This contract does **not** require research-only strategy promotion (Hold-
Strike/Defined-Risk graduating) for the first Conventional Paper trade --
consistent with the directive's own instruction -- but it does require the
`MANAGEMENT_CANDIDATES_REAL` and `AEGIS_NO_AVOIDABLE_UNKNOWN` gates to close
first, since a bot that can open a CSP but never roll it or manage an
assigned position's covered call is not "ready" by this contract's own
standard.
