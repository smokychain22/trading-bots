# THETA Hypothesis Registry Reconciliation (R6)

**Actual current entry count: 14** (`bots/theta/quant/research/data/hypotheses.json`,
counted programmatically this pass -- not assumed from a prior session's memory,
per the explicit instruction not to assume 13 or 14). The registry is not rebuilt
here; this document reconciles the existing `status`/`data_availability_status`
fields onto the requested `READY_TO_TEST / BLOCKED_ON_DATA / LOGICALLY_REJECTED /
DUPLICATE / NEEDS_RECONSTRUCTION` taxonomy and records the per-hypothesis detail
the directive requested (source, evidence class, mechanism, features, target, PIT
requirements, falsification test, leakage risk, execution dependency) by reference
to the fields already present in the JSON, rather than duplicating that text here.

## Reconciliation

| ID | Archetype | Existing status | Existing data-availability | **Reconciled classification** | Why |
|---|---|---|---|---|---|
| H-Q-01 | THETA-Q | TEST | TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA | **READY_TO_TEST** | Falsifiable, feature set exists (ownership_v0.py), no logical defect found; blocked only by the platform-wide absence of a real historical options-chain dataset, not by anything specific to this hypothesis |
| H-Q-02 | THETA-Q | TEST | TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA | **READY_TO_TEST** | Confirmatory measurement of an already-enforced TRD rule (UNIV-002); registered experiment (EXP-Q-02), same platform-wide data blocker only |
| H-H-01 | THETA-H | TEST | TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA | **READY_TO_TEST**, flagged HIGH SCRUTINY | THETA-H per-directive special scrutiny: this cohort's own independent-cluster N will be small by design (narrow 2-5 DTE universe) -- ready to test, but its acceptance criterion already requires gap-aware backtesting and independent OOS validation that must never borrow THETA-Q's evidence |
| H-H-02 | THETA-H | RETAIN | ARCHITECTURE_CHECK_NOT_DATA_DEPENDENT | **READY_TO_TEST** (architecture-check form) | Not a statistical experiment -- verifiable today by inspecting whether every THETA-H performance view exposes Leg WR + Managed Episode WR + Whole-Chain WR + Open MTM together. Ready to run now, no data blocker at all |
| H-R-01 | THETA-R | TEST | TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA | **READY_TO_TEST** | Deliberately paired with H-R-02 as competing hypotheses (not a duplicate -- see below); must share candidate set/period with EXP-R-02 |
| H-R-02 | THETA-R | TEST | TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA | **READY_TO_TEST** | See H-R-01 -- intentionally preserved as the opposing hypothesis, resolved empirically by A5, not by inspection |
| H-R-03 | THETA-R | RETAIN | TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA | **READY_TO_TEST** | Already a hard TRD rule (ROLL-002); the registered experiment (EXP-R-03) exists to size the effect, not decide whether the rule applies |
| H-C-01 | THETA-C | RETAIN | TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA | **READY_TO_TEST** | Already required by TRD LIFE-004; EXP-C-01 sizes the effect against BC-1 |
| H-C-02 | THETA-C | RETAIN | TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA | **READY_TO_TEST** | Already a non-negotiable rule (no immediate CC after every assignment) and TRD STRAT-003; EXP-C-02 is confirmatory |
| H-A-01 | THETA-A | RETAIN | TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA | **READY_TO_TEST** | TRD STRAT-002 already treats assignment as intentional; B6 (buy-and-hold) provides the confirmatory comparison |
| H-A-02 | THETA-A | RETAIN | ARCHITECTURE_CHECK_NOT_DATA_DEPENDENT | **READY_TO_TEST** (architecture-check form) | Verifiable today: does every RECOVERY_WAIT code path enforce SOME bound? No data dependency |
| H-A-04 | THETA-A | TEST | TESTABLE_WITH_HISTORICAL_OPTIONOMICS_ALPACA_DATA | **READY_TO_TEST**, flagged HIGH LEAKAGE RISK | The genuinely open, parameterized half split out of the old conflated H-A-02. Its own `failure_mode` field already specifies a 4-step selection/confirmation discipline to prevent exactly the "select bound on OOS, then report that OOS result as confirmation" leak (ML-002) -- the highest self-documented leakage risk in the registry |
| H-A-03 | THETA-A | RETAIN | ARCHITECTURE_CHECK_NOT_DATA_DEPENDENT | **READY_TO_TEST** (architecture-check form) | Same cross-cutting OUT-001..004 reporting constraint as H-H-02, restated for THETA-A specifically |
| H-D-01 | THETA-D | TEST | BLOCKED_ON_ALPACA_ENTITLEMENT | **BLOCKED_ON_DATA** | Explicitly gated (`gated_until`): requires Alpaca options Level 3 entitlement AND THETA-Q/H/R/C/A graduation first. Registered for completeness only -- implementation must not begin |

**LOGICALLY_REJECTED: none.** No hypothesis in the current registry has been
falsified or found internally inconsistent -- correct, since none has ever been run
against real data (`EV_MODEL_NOT_EMPIRICALLY_READY`).

**DUPLICATE: none.** H-R-01/H-R-02 look like candidates for this label but are NOT
duplicates -- they are deliberately preserved as a competing pair (`contradicts`
field on both), to be resolved empirically by ablation A5, not by inspection or by
averaging the two experts' claims. Collapsing them into one entry would manufacture
a compromise neither expert actually demonstrated -- explicitly rejected in the
registry's own `rationale` field for both.

**NEEDS_RECONSTRUCTION: none this pass.** The one hypothesis that previously needed
reconstruction (the original conflated H-A-02) was already split into H-A-02
(architectural constraint) + H-A-04 (parameterized empirical question) in a prior
session -- recorded in H-A-02's own `rationale` field. No further reconstruction
need was found this pass.

## Summary counts

| Classification | Count | IDs |
|---|---|---|
| READY_TO_TEST | 13 | H-Q-01, H-Q-02, H-H-01, H-H-02, H-R-01, H-R-02, H-R-03, H-C-01, H-C-02, H-A-01, H-A-02, H-A-04, H-A-03 |
| BLOCKED_ON_DATA | 1 | H-D-01 |
| LOGICALLY_REJECTED | 0 | -- |
| DUPLICATE | 0 | -- |
| NEEDS_RECONSTRUCTION | 0 | -- |

Every hypothesis already carries, in its own JSON record, the source_experts
(with evidence_state: OBSERVED/RECONSTRUCTED/INFERRED), mechanism, feature_families_
required, label_definition/payoff_target (the PIT-safe target), failure_mode
(which doubles as the leakage-risk note for most entries), and
acceptance_criterion/rejection_criterion (the falsification test). This document
does not duplicate those fields -- see the JSON directly for any single
hypothesis's full detail. "Execution dependency" is uniform across all 14: none
require any change to broker execution to be TESTED (all are backtest/replay
questions); H-D-01 alone has a genuine execution/entitlement dependency
(Alpaca Level 3) before it may even be IMPLEMENTED, which is a stronger and
separate gate from being merely tested.
