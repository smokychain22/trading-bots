# THETA Strategy DNA Matrix

Durability artifact. Cross-references `research/data/strategy_archetypes.json` (the
six THETA-Q/H/R/C/A/D archetypes, IMPLEMENTED as data) against
`EXPERT_REGISTRY.md`'s 11 experts and `THETA_HYPOTHESIS_LIBRARY.md`'s hypotheses, so the
DNA lineage from expert observation to archetype to testable hypothesis is visible in
one place rather than requiring three separate JSON reads to reconstruct.

| Archetype | Primary experts | Hypotheses | Runtime branch relationship |
|---|---|---|---|
| THETA-Q (Quality Ownership) | `orange_cat` (OBSERVED), `david_romic` (INFERRED), `sqqq_hold_the_strike` (OBSERVED, failure DNA) | H-Q-01, H-Q-02 (both TEST) | Cross-cutting — every branch's entry step depends on this archetype's ownership judgment; not itself a runtime branch. |
| THETA-H (Hold-the-Strike) | `iwm_hold_the_strike` (RECONSTRUCTED), `sqqq_hold_the_strike` (OBSERVED, failure DNA) | H-H-01 (TEST, narrow-cohort), H-H-02 (RETAIN, measurement guard) | Direct match: `THETA_HOLD_STRIKE` — explicitly a research challenger, not the default. |
| THETA-R (Roll Intelligence) | `hendo_67` (OBSERVED), `wheeling_to_freedom` (RECONSTRUCTED), `orange_cat` (OBSERVED), `alex` (RECONSTRUCTED) | H-R-01 vs. H-R-02 (contradictory pair, both TEST, deliberately unresolved pending A5), H-R-03 (RETAIN) | Cross-cutting — management/roll decisions apply inside any branch's open position. |
| THETA-C (Covered-Call Monetization) | `hendo_67` (OBSERVED), `orange_cat` (OBSERVED) | H-C-01, H-C-02 (both RETAIN — architecturally required, empirically sized) | Direct match: `THETA_CC`. |
| THETA-A (Assignment/Recovery) | `orange_cat` (OBSERVED), `iwm_hold_the_strike` (RECONSTRUCTED), `sqqq_hold_the_strike` (OBSERVED, failure DNA) | H-A-01 (RETAIN), H-A-02 (RETAIN, settled bound-must-exist constraint), H-A-03 (RETAIN, measurement guard), H-A-04 (TEST, parameterized sweep) | Direct match: `THETA_RECOVERY`, plus the full CSP-to-stock lineage. |
| THETA-D (Defined-Risk Challenger) | `ivan_small_account` (INFERRED), `ivan_orehovec` (OBSERVED), `lick_neeson` (INFERRED) | H-D-01 (TEST, **GATED** — Level 3 + THETA-Q/H/R/C/A graduation required) | Direct match: `THETA_DEFINED_RISK` — explicitly deferred, do not implement ahead of gate. |

## Cross-cutting failure DNA (applies to all six archetypes)

Per `strategy_archetypes.json`'s `cross_cutting_failure_dna` block, sourced from
`sqqq_hold_the_strike` and `fearless_value`: **a high closed-trade or Leg win rate never
proves an archetype is safe on its own.** Every archetype's performance must be
reported as Leg WR, Managed Episode WR, Whole-Chain WR, and Open MTM together (TRD
OUT-001..004). This is why H-H-02 and H-A-03 exist as standing RETAIN measurement
guards rather than one-off notes — the same discipline is registered per-archetype
where the risk of violating it is sharpest (THETA-H and THETA-A specifically, both
assignment-heavy by design), while remaining a platform-wide rule.

## DNA lineage discipline

An expert's `borrowed_prior` licenses hypothesis generation for exactly the archetype
it was cataloged against — `iwm_hold_the_strike`'s 2-5 DTE prior informs THETA-H, it
does not get silently reused to justify a THETA-Q conventional-lattice decision, and
`ivan_small_account`'s defined-risk hints inform THETA-D only, explicitly gated and not
merged into the active-archetype policy set. Cross-archetype transfer of an expert's
evidence requires a new, explicit hypothesis entry with its own acceptance/rejection
criteria — never an implicit assumption that a prior validated for one archetype
carries over to another.

## Status

Fully derived from already-IMPLEMENTED data (`strategy_archetypes.json`,
`expert_sources.json`, `hypotheses.json`). No new hypotheses, experts, or archetypes are
introduced by this file.
