# Phase 2-4 Durabilization — Adversarial Correction Pass

Conducted after assembling `docs/quant/phase2/`, `docs/quant/phase3_strategy_dna/`, and
`docs/quant/phase4_method_corpus/`. Checked against: contradictions with TRD, duplicate
formulas, ambiguous units, leakage, hindsight labels, delta-as-probability, automatic
assignment-win accounting, hidden stock losses, roll-loss erasure, automatic CC after
assignment, midpoint fills, fixed quantity floors, fabricated missing values, future
data, unsupported expert claims, unsupported GitHub claims, license problems,
performance claims. Each finding classified RETAIN / CORRECT / TEST / REJECT.

## Findings

1. **The original Parallel Phase 3 trader corpus and Parallel Phase 4 20-repository
   corpus were never persisted to this repository.** Both durabilization packages were
   built strictly from already-committed structured data
   (`expert_sources.json`'s 11 experts; the pattern lists supplied directly in the
   current durabilization instruction) rather than reconstructing unverifiable names,
   URLs, or attributed findings from an uncertain memory of prior conversational
   sessions. **Classification: CORRECT** — this is the single most consequential
   finding of the whole pass. Recorded explicitly in `EXPERT_REGISTRY.md` and
   `GITHUB_METHOD_CORPUS.md` rather than silently worked around. No fabrication
   occurred; the gap is the finding.

2. **`severe_drawdown_spec.py`'s label status enum (`BREACHED`/`SURVIVED`/`CENSORED`)
   has no path for corporate-action ambiguity** (a split/merger/spinoff making the
   breach/survive determination genuinely undecidable, distinct from ordinary missing
   data). A fourth status, `CORPORATE_ACTION_AMBIGUOUS`, was proposed in
   `PHASE2_MASTER_SPEC.md` §5 but is **not implemented** in the module itself.
   **Classification: CORRECT** (the underlying idea — a fourth status is needed — is
   right, but it requires an actual code change to `severe_drawdown_spec.py`, which
   this durabilization pass deliberately did not make, per Part E's instruction not to
   implement a model just so a file can say it is implemented). **Action for a future
   session:** add the status and a corresponding test before relying on this label for
   any real fitting work.

3. **`THETA_CycleUtility` has no single registered closed-form combination.** The TRD
   names it as the conceptual objective, but composing `WholeChainPnL`,
   `ReturnPerCapitalDay`, DD/ES, and inventory-duration penalties into one scalar risks
   recreating the "opaque blended score" anti-pattern (TRD CAND-003) this repo
   otherwise avoids everywhere else (every score in `theta_q_baseline.py`/
   `ownership_v0.py` is componentized and reason-coded). **Classification: TEST** —
   correctly already marked TEST rather than RETAIN in `FORMULA_REGISTRY.md`; recorded
   here to make the reasoning visible rather than only the conclusion. **No action
   required** — the recommendation (report components separately until a specific
   weighting is itself validated) is sound and already stated.

4. **`ReturnPerCapitalDay`'s `HoldingDays` unit convention is unspecified** (calendar
   days vs. trading days) — an ambiguous-units risk flagged by this correction pass's
   own checklist. **Classification: CORRECT.** **Action for a future session:** state
   the convention explicitly (recommend calendar days, since capital is locked up
   calendar-continuously regardless of market sessions) before this formula is
   implemented in code.

5. **The benchmark registry (`benchmarks.json`) has no single ID for the combined
   "fixed delta + fixed DTE" naive control**, nor for the "always roll if credit
   positive" naive policy EXP-R-03 is designed to beat (it's described in
   `experiments.json`'s `EXP-R-03` entry but has no benchmark ID of its own).
   **Classification: TEST** (a real gap, but not urgent — no experiment currently
   blocked by its absence, since `EXP-R-03`'s comparison is fully specified in prose
   even without a dedicated ID). **Action for a future session:** consider adding
   `BQ-4` (combined naive) and `BR-3` (always-roll-if-credit-positive) to
   `benchmarks.json` before any experiment that needs to reference them by ID rather
   than by description. This durabilization pass does not add them itself, to avoid
   modifying the existing canonical registry beyond what's strictly needed (Part H's
   "one source of truth per concept," "update only if the missing item belongs there").

6. **AEGIS's "exit supremacy" principle (a `HARD_VETO`/`HOLD_ONLY` state must still
   permit closing/reducing existing risk, never blocking an exit the way it blocks a
   new entry) is not yet explicit in `AEGIS_SIZING_EXECUTION_CONTRACT.md`'s risk-state
   table.** Surfaced while writing `METHOD_EXTRACTION_REGISTRY.md`'s kill-switch/ARM-
   gate/exit-supremacy entry. **Classification: CORRECT.** **Action for a future
   session:** add an explicit line to the AEGIS contract's §1 stating that every risk
   state permits position-reducing actions regardless of how restrictive it is for
   new entries — this is implied by "AEGIS never blocks a de-risking action" as a
   general safety principle but was not stated as a standing rule anywhere in this
   repository before this correction pass found the gap.

## Checklist items with no finding (explicitly checked, nothing wrong found)

- **Contradictions with TRD:** none — every claim in the three packages cites the TRD
  section, hypothesis ID, or non-negotiable rule it restates, and none contradicts an
  existing rule.
- **Duplicate formulas:** none — `FORMULA_REGISTRY.md` is the single definition site;
  every other file references it rather than restating formulas.
- **Leakage:** no new leakage introduced; every label definition in
  `DATASET_AND_LABEL_CONTRACT.md` explicitly states its guard, consistent with the
  guards already implemented in `severe_drawdown_spec.py`/`recovery_spec.py`.
- **Hindsight labels:** the CC/assignment label's necessarily-retrospective-for-
  training-but-never-for-serving distinction is stated explicitly, not glossed over.
- **Delta treated as probability:** not done anywhere in the new package; the
  non-negotiable rule is restated, not violated.
- **Automatic assignment-win accounting / hidden stock losses / roll-loss erasure /
  automatic CC after assignment / midpoint fills / fixed quantity floors:** all
  explicitly named as rejected anti-patterns with cross-references to the existing
  rule or test that guards against each; none introduced.
- **Fabricated missing values / future data:** none introduced anywhere in the three
  packages.
- **Unsupported expert claims:** avoided by grounding `EXPERT_REGISTRY.md` strictly in
  `expert_sources.json`'s 11 already-committed entries (finding 1 above is the honest
  accounting of what's missing, not a fabrication of it).
- **Unsupported GitHub claims / license problems:** avoided by generalizing
  `METHOD_EXTRACTION_REGISTRY.md`/`LICENSING_REGISTRY.md` to pattern taxonomies rather
  than attributing findings to specific unverified repositories (finding 1 covers this
  too).
- **Performance claims:** none made anywhere in any of the twenty-one files this
  durabilization pass created.

## Summary disposition

Six findings, all CORRECT or TEST severity, zero REJECT (nothing durabilized needed to
be thrown out) and zero RETAIN-level contradictions with the TRD. Findings 2, 4, and 6
are concrete, small, future code/data changes flagged for a subsequent session rather
than made in this pass (consistent with Part E: do not implement just to make a file
say something is implemented). Findings 3 and 5 are already-correct TEST
classifications, surfaced here for visibility rather than requiring any change.
Finding 1 is the structural finding this entire durabilization task exists to address
and is handled by scoping the new packages to what can honestly be grounded in
already-committed evidence.

## Integration-review documentation correction

Git records 21 durability files, not 18. The original count in this audit was a
handoff-count error, not a claim about research evidence. Formula references were also
aligned during integration to the canonical TRD Appendix A definitions for
`ReturnPerCapitalDay`, `ManagementUtility`, `RollUtility`, and
`OpportunityCaptureRate`. These are documentation corrections only. No quant/runtime
implementation or empirical result changed.
