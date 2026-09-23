# THETA brain capability matrix

Historical research audit. Current source/release truth is in
`src/theta/canonical-system-truth.ts` (`npm run theta:truth`). Several claims
below about missing H/D construction, management candidate sources and
permanently null AEGIS stress inputs are superseded by current source. None
of those source fixes proves that the pinned worker runs them. Do not use this
matrix as a Paper-readiness gate.

> **CORRECTION (Wave 6, 2026-09-22)**: any Hold-Strike/Defined-Risk row
> below marked as having no candidate-construction code path is
> incomplete/withdrawn -- `canonical-strategy-frontier.ts` contains real
> construction logic for both. `RUNTIME_REACHABLE` for either branch
> remains unproven (upstream chain-fetch window not verified). See
> `THETA_CANONICAL_FRONTIER_HD_RECONCILIATION.md`.

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
| SIZE | YES | YES (Python sizing bridge) | Not independently verified | YES | **NO -- AEGIS unconditionally returns HOLD_ONLY (verified line-by-line, `aegis.py`), so sizing for a new-risk action is never actually invoked with a permissive state today** | YES | NO | NO | AEGIS SYSTEM+LIQUIDITY stress gap (P0-0) blocks this regardless of sizing's own correctness |
| OPEN (entry decision) | YES | YES (canonical frontier, within-THETA_Q) | Not independently verified | YES | **NO -- same AEGIS block.** The frontier can rank candidates, but `is_action_permitted(HOLD_ONLY, 'OPEN_CSP')` is provably `False` on every real cycle today | YES (THETA_CONVENTIONAL) | NO (`empiricalUtilityState: UNKNOWN_NOT_YET_CALIBRATED`) | NO | **PROMOTED THIS PASS**: AEGIS SYSTEM+LIQUIDITY stress gap (P0-0) -- see `THETA_PRE_VPS_UNKNOWN_LEDGER.md` items 2/5. Previously this row read YES for RUNTIME_REACHABLE based on the frontier/router path alone; a direct read of `aegis.py` shows the downstream AEGIS gate makes the actual OPEN action unconditionally unreachable today, independent of the cross-branch comparison gap already noted |
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

A bot cannot be called intelligent because a method exists. **This section was
revised this pass following a direct, line-by-line read of
`bots/theta/quant/models/aegis.py`, which overturns the entry-side verdict
this matrix previously reported.** THETA's entry-side machinery for a single
branch (THETA_CONVENTIONAL) -- universe, ranking, router, lattice, delta,
frontier, sizing -- is genuinely real and structurally sound end to end
(structurally, not empirically -- no calibration has ever been attempted,
honestly represented as such). **But the OPEN and SIZE rows above are NOT
`RUNTIME_REACHABLE` today**, because AEGIS unconditionally returns
`HOLD_ONLY` for every new-risk-opening action on every real cycle -- a
mathematical consequence of two permanently-`None` stress inputs feeding TWO
separate risk families (SYSTEM and LIQUIDITY), confirmed by direct reading
of `_liquidity()`, `_system()`, `assess_aegis()`'s worst-family-wins fold,
and the literal `_NEW_RISK_ACTIONS_BY_STATE[HOLD_ONLY] = frozenset()` dict.
This is now the single most severe finding of the whole pre-VPS audit,
independent of and more fundamental than the previously-known
`CONTRACT_NOT_EXECUTABLE` gap: even a perfectly executable, perfectly-ranked
candidate would still be refused.

THETA's **management side is separately split**: HOLD/CLOSE/ASSIGNMENT/
RECOVERY/SELL_STOCK/CALL_AWAY are real and reachable; **ROLL, ROLL_CC, and
SELL_CC are NOT** -- despite having real, tested, economically-correct
valuation logic (including a real safety rule against selling a covered call
below cost basis) -- because their shared candidate-source producer does not
exist in Production. This remains a second, independent P0 gap.

No row in this matrix claims `EMPIRICALLY_LEARNED = YES` or
`OOS_VALIDATED = YES` anywhere -- consistent with the standing rule that no
model has been fit and none should be claimed.
