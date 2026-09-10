# THETA Opportunity Frontier / Anti-Paralysis Engine

Durability artifact for `bots/theta/quant/models/opportunity_frontier.py`, built in
response to an explicit architectural requirement: THETA must not degrade into an
OPEN-vs-WAIT classifier, where one unattractive candidate causes the whole engine to
sit idle, or where model disagreement/uncertainty is treated as an automatic reason to
do nothing.

## What this module is

A book-level classifier and ranker that sits above per-candidate economic evaluation
(`theta_q_baseline.py`, `ownership_v0.py`, `aegis.py`). It does not compute EV, ownership,
or risk state itself — it consumes those already-computed outputs and answers two
questions the upstream modules deliberately don't: **what should happen to each
individual candidate** (WAIT vs. PASS vs. OPEN_FULL/REDUCED/ALTERNATE_*), and **is the
engine's overall idleness, if any, actually justified** (a `GlobalIdleReport`, never a
bare "WAIT").

## WAIT vs. PASS (structural, not semantic convention)

- **WAIT** (`WAIT_PRICE`/`WAIT_VOL`/`WAIT_LIQUIDITY`/`WAIT_EVENT`/`WAIT_REGIME`):
  reserved for conditions this module's `_classify` function treats as transient —
  event proximity, insufficient liquidity, insufficient IV compensation, unfavorable
  regime. Each carries a specific sub-reason so a caller's scheduler can attach a
  recheck trigger.
- **PASS**: reserved for conditions treated as currently structural —
  ownership-unacceptable, non-positive after-cost EV, an AEGIS block with no available
  fallback, or a genuinely unresolved (`UNKNOWN`) required input. A `rejection_category`
  field records which bucket, so a `GlobalIdleReport` can be built from real tallies
  rather than string-matching reason text.

## One candidate's WAIT/PASS never blocks another's OPEN

`build_opportunity_book` classifies every candidate independently and only returns a
`GlobalIdleReport` when **zero** candidates qualify for any `OPEN_*` disposition. This
is the single guarantee this module exists to provide, and it's the first thing its
test suite checks (`test_a_single_wait_candidate_does_not_prevent_another_from_opening`).

## Uncertainty governs size, not action

Per the explicit requirement that elevated model uncertainty must not automatically
mean WAIT: `_classify` checks AEGIS permission and structural/transient conditions
first, and only then applies `model_uncertainty` — and even then, only to choose
`OPEN_REDUCED` over `OPEN_FULL`, never to reject a structurally sound, positive-EV
candidate outright.

## `HoldAdvantage` — the antidote to a fixed 25/50/75% TP

Added to `management_action_value.py` as `hold_advantage(decision)`:
`HoldAdvantage = U_HOLD - max(U_CLOSE, U_ROLL, U_ASSIGN, U_EXPIRE, U_REDEPLOY)`. This
makes the "does continuing to hold still dominate" question a named, inspectable
quantity instead of an implicit side-effect of `evaluate_management_alternatives`'s own
`argmax` — useful for reporting *why* THETA held past (or closed before) a
conventional TP benchmark, per the requirement that profit-taking be state-dependent
rather than a fixed percentage.

## What this module explicitly does not do

It does not search a strike/DTE lattice itself (that's `theta_q_lattice.py`'s job,
already implemented), does not compute AEGIS state (`aegis.py`), does not compute
sizing (`sizing.py`), and does not persist a shadow opportunity book to any database —
that persistence layer is Codex's runtime/ledger responsibility (R2), not this quant
module's. This file provides the classification/ranking function a persistence layer
would call, not the persistence itself.

## Explicit non-fabrication note

A message accompanying this request also referenced a specific 20-repository GitHub
method corpus (with exact repository names) and additional named traders (MAR1 QUANT,
EnhancedMarket, Renee, Swayd, TeamTape) with specific behavioral claims, distinct from
the 11 experts already in `expert_priors/data/expert_sources.json`. **None of this was
verified or found in this repository, and none of it is durabilized here or anywhere
else.** This is the same discipline applied in `docs/quant/phase4_method_corpus/
GITHUB_METHOD_CORPUS.md` and `docs/quant/phase3_strategy_dna/EXPERT_REGISTRY.md` for
the original unverified Phase 3/4 corpus — fabricating study of unverified sources
would violate this project's evidentiary standard regardless of how specific or
plausible the names look. If real source material exists, it needs to be supplied
directly (a file this session can read) before it can be durabilized.

## Status

IMPLEMENTED (transparent baseline, MODEL-001) — 23 new tests (19 for
`opportunity_frontier.py`, 4 for `hold_advantage`), all passing. Not yet wired into any
TypeScript runtime orchestration or persistence layer.
