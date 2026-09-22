# THETA brain capability matrix

Status: Slice 12/20 of the pre-VPS master continuation directive. This is the
authoritative defense against "a function exists, therefore the bot has
intelligence." Every row is grounded in this engagement's direct source
reads, forensic evidence, or explicit prior findings -- never in a function's
name alone.

Column values: `YES` / `PARTIAL` / `NO` / `NOT_APPLICABLE`, each with the
evidence that grounds it.

| Decision | CAN_REPRESENT | REAL_PRODUCER | PERSISTED | CONSUMED | RUNTIME_REACHABLE | PAPER_AUTHORIZED | EMPIRICALLY_LEARNED | OOS_VALIDATED | CURRENT_BLOCKER |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UNDERLYING selection | YES | YES (avgDollarVolume baseline, `discoverRealUniverse`) | Not independently verified | YES | YES | YES (THETA_CONVENTIONAL) | NO (placeholder baseline) | NO | Baseline is a simple placeholder; real challengers exist only as research |
| Strategy applicability (branch eligibility) | YES | PARTIAL (`new-risk-orchestrator.ts` only checks THETA_Q eligibility) | Not independently verified | YES | YES for THETA_Q; NO real candidate path for THETA_H/THETA_D | THETA_CONVENTIONAL/RECOVERY/CC only | NO | NO | No entry-candidate generation exists for Hold-Strike/Defined-Risk at all |
| DTE selection | YES | YES (`theta_q_lattice.py`, `build_candidate_grid`) | Not independently verified | YES | YES | YES | NO | NO | none confirmed |
| Strike selection | YES | YES (same lattice module) | Not independently verified | YES | YES | YES | NO | NO | none confirmed |
| Delta | YES | YES (`_delta_band_for`, real Alpaca Greeks) | Not independently verified | YES | YES | YES | NO | NO | none confirmed |
| SIZE | YES | YES (Python sizing bridge) | Not independently verified | YES | CONDITIONAL (gated behind AEGIS/Pareto survival) | YES | NO | NO | Only reached after upstream survival; `sizingEvidenceUnknown` gating correctly prevents a false-safe WAIT |
| OPEN (entry decision) | YES | YES (canonical frontier, within-THETA_Q) | Not independently verified | YES | YES | YES (THETA_CONVENTIONAL) | NO (`empiricalUtilityState: UNKNOWN_NOT_YET_CALIBRATED`) | NO | Cross-branch economic comparison does not exist (only one branch's candidates ever coexist today) |
| WAIT | YES | YES (`globalWaitEarned`/`sizingEvidenceUnknown` gating, fixed on `main` per `bf6d80e`) | Not independently verified | YES | YES on `main`; NOT YET CONFIRMED deployed to the pinned worker | YES | NO | NO | Fix exists but deployment status to the running worker is unconfirmed |
| HOLD | YES | YES (`paper-bootstrap-management-policy.ts:681-724`) | Not independently verified | YES | YES | YES | NO | NO | none confirmed |
| CLOSE (CLOSE_FULL) | YES | YES | Not independently verified | YES | YES | YES | NO | NO | none confirmed |
| ROLL | YES | YES valuator, **NO real candidate source** | N/A (never reached) | Blocked | **NO -- P0** | Blocked | NO | NO | Candidate-source gap (Unknown Ledger item 1) |
| ASSIGNMENT (ACCEPT_ASSIGNMENT) | YES | YES (structural moneyness gating, `management-action-frontier.ts`) | Not independently verified | YES | YES (structural only, zero economic optimization by design) | YES | NO | NO | None -- honest, documented design choice, not a defect |
| RECOVERY (RECOVERY_WAIT) | YES | YES (`buildRecoveryState`, real `computeEffectiveStockBasis`) | Not independently verified | YES | YES | YES | NO | NO | none confirmed |
| SELL STOCK | YES | YES (`:912-960`, deliberately does not require known basis) | Not independently verified | YES | YES | YES | NO | NO | none confirmed |
| SELL CC | YES | YES valuator (incl. real basis-floor safety rule), **NO real candidate source** | N/A (never reached) | Blocked | **NO -- P0** | Blocked | NO | NO | Same candidate-source gap as ROLL |
| HOLD CC | YES | YES (shares HOLD mechanism) | Not independently verified | YES | YES | YES | NO | NO | none confirmed |
| CLOSE CC | YES | YES (shares CLOSE_FULL mechanism) | Not independently verified | YES | YES | YES | NO | NO | none confirmed |
| ROLL CC | YES | YES valuator, **NO real candidate source** | N/A (never reached) | Blocked | **NO -- P0** | Blocked | NO | NO | Same candidate-source gap |
| CALL AWAY (ALLOW_CALL_AWAY) | YES | YES (structural gate + real whole-chain P&L reuse) | Not independently verified | YES | YES (structural only, zero economic optimization by design) | YES | NO | NO | None -- honest design choice |

## Summary verdict

A bot cannot be called intelligent because a method exists. By this matrix's
own evidence: THETA's **entry side for a single branch (THETA_CONVENTIONAL)**
is genuinely `YES_REAL_AND_REACHABLE` end to end, structurally (not yet
empirically -- no calibration has ever been attempted, honestly represented
as such). THETA's **management side is split**: HOLD/CLOSE/ASSIGNMENT/
RECOVERY/SELL_STOCK/CALL_AWAY are real and reachable; **ROLL, ROLL_CC, and
SELL_CC are NOT** -- despite having real, tested, economically-correct
valuation logic (including a real safety rule against selling a covered call
below cost basis) -- because their shared candidate-source producer does not
exist in Production. This single gap is responsible for 3 of the 19 rows in
this matrix reading `NO` for `RUNTIME_REACHABLE`, and it is the highest-
priority item in every backlog this pre-VPS audit has produced.

No row in this matrix claims `EMPIRICALLY_LEARNED = YES` or
`OOS_VALIDATED = YES` anywhere -- consistent with the standing rule that no
model has been fit and none should be claimed.
