"""Walk-forward fold construction for THETA's calibrated models (R6).

Implements `docs/research/THETA_WALK_FORWARD_SPEC.md`'s fold structure
as real, testable code: TRAIN -> embargo -> VALIDATION -> embargo ->
FORWARD TEST, rolled forward, with a final untouched OOS segment. Groups
by `chain_id` so a chain that spans a fold boundary (e.g. a roll or
recovery extends its resolution past the original entry's own horizon)
is assigned ENTIRELY to one fold, never split across TRAIN and
VALIDATION/TEST -- the single most important leakage guard this module
enforces, directly responding to the corpus review finding that a naive
row-level split can leak correlated observations across folds.

No I/O, no provider dependency, no real historical data -- this module
operates over whatever chain-level records (id, an ordering timestamp)
the caller supplies, and is exercised only against synthetic fixtures
until real resolved episodes exist in sufficient number
(`THETA_EV_MODEL_SPEC.md`'s EV_MODEL_NOT_EMPIRICALLY_READY status).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, List, Sequence, Tuple


def _parse_date(value: str) -> date:
    text = value.replace("Z", "+00:00") if "T" in value else value
    if "T" in text:
        return datetime.fromisoformat(text).date()
    return date.fromisoformat(text)


@dataclass(frozen=True)
class ChainRecord:
    """One chain's identity and ordering timestamp for fold-assignment
    purposes. `resolved_at` is the chain's own resolution date (for a
    RESOLVED chain) -- a CENSORED_OPEN chain has no resolution date and
    must never be passed to this module at all (the caller filters via
    `chain_resolution.py` before this point)."""

    chain_id: str
    resolved_at: str  # ISO date


@dataclass(frozen=True)
class WalkForwardFold:
    fold_index: int
    train_chain_ids: Tuple[str, ...]
    validation_chain_ids: Tuple[str, ...]
    forward_test_chain_ids: Tuple[str, ...]
    train_window: Tuple[str, str]  # (start, end) ISO dates, inclusive
    validation_window: Tuple[str, str]
    forward_test_window: Tuple[str, str]


@dataclass(frozen=True)
class WalkForwardPlan:
    folds: Tuple[WalkForwardFold, ...]
    final_oos_chain_ids: Tuple[str, ...]  # untouched by every fold above; touched exactly once, by the caller, for confirmation only
    final_oos_window: Tuple[str, str]
    excluded_by_embargo_chain_ids: Tuple[str, ...]  # chains that fell inside a purge/embargo gap -- used by NEITHER train NOR test in the fold(s) they'd otherwise border


def build_walk_forward_plan(
    chains: Sequence[ChainRecord],
    train_days: int,
    validation_days: int,
    forward_test_days: int,
    embargo_days: int,
    step_days: int,
    final_oos_days: int,
) -> WalkForwardPlan:
    """Builds a rolled TRAIN/embargo/VALIDATION/embargo/FORWARD-TEST plan
    over already-resolved chains, reserving `final_oos_days` at the very
    end of the timeline as a final, untouched OOS segment excluded from
    every rolled fold entirely.

    `embargo_days` must exceed the longest label-resolution horizon in
    use for the label being validated (per `THETA_WALK_FORWARD_SPEC.md`
    §1 -- the caller chooses this value per label type; this function
    does not pick one itself, since a recovery-label embargo and an
    entry-label embargo are genuinely different sizes).

    Every chain is grouped into EXACTLY ONE of: a fold's TRAIN, a fold's
    embargo-exclusion, a fold's VALIDATION, a fold's FORWARD TEST, or the
    final OOS segment -- never split, never counted twice.
    """
    if not chains:
        return WalkForwardPlan(folds=(), final_oos_chain_ids=(), final_oos_window=("", ""), excluded_by_embargo_chain_ids=())

    sorted_chains = sorted(chains, key=lambda c: (_parse_date(c.resolved_at), c.chain_id))
    timeline_start = _parse_date(sorted_chains[0].resolved_at)
    timeline_end = _parse_date(sorted_chains[-1].resolved_at)

    final_oos_start = timeline_end - timedelta(days=final_oos_days - 1)
    final_oos_chains = [c for c in sorted_chains if _parse_date(c.resolved_at) >= final_oos_start]
    rollable_chains = [c for c in sorted_chains if _parse_date(c.resolved_at) < final_oos_start]

    folds: List[WalkForwardFold] = []
    excluded_by_embargo: List[str] = []

    fold_index = 0
    window_start = timeline_start
    while True:
        train_start, train_end = window_start, window_start + timedelta(days=train_days - 1)
        embargo1_start, embargo1_end = train_end + timedelta(days=1), train_end + timedelta(days=embargo_days)
        validation_start, validation_end = embargo1_end + timedelta(days=1), embargo1_end + timedelta(days=validation_days)
        embargo2_start, embargo2_end = validation_end + timedelta(days=1), validation_end + timedelta(days=embargo_days)
        forward_start, forward_end = embargo2_end + timedelta(days=1), embargo2_end + timedelta(days=forward_test_days)

        if forward_end >= final_oos_start:
            break  # this fold would run into the reserved final-OOS segment -- stop rolling

        def _in_window(chain: ChainRecord, start: date, end: date) -> bool:
            d = _parse_date(chain.resolved_at)
            return start <= d <= end

        train_ids = tuple(c.chain_id for c in rollable_chains if _in_window(c, train_start, train_end))
        validation_ids = tuple(c.chain_id for c in rollable_chains if _in_window(c, validation_start, validation_end))
        forward_ids = tuple(c.chain_id for c in rollable_chains if _in_window(c, forward_start, forward_end))
        embargo_ids = [
            c.chain_id for c in rollable_chains
            if _in_window(c, embargo1_start, embargo1_end) or _in_window(c, embargo2_start, embargo2_end)
        ]
        excluded_by_embargo.extend(embargo_ids)

        folds.append(WalkForwardFold(
            fold_index=fold_index,
            train_chain_ids=train_ids, validation_chain_ids=validation_ids, forward_test_chain_ids=forward_ids,
            train_window=(train_start.isoformat(), train_end.isoformat()),
            validation_window=(validation_start.isoformat(), validation_end.isoformat()),
            forward_test_window=(forward_start.isoformat(), forward_end.isoformat()),
        ))

        fold_index += 1
        window_start = window_start + timedelta(days=step_days)

    final_oos_window = (
        (final_oos_start.isoformat(), timeline_end.isoformat()) if final_oos_chains else ("", "")
    )

    return WalkForwardPlan(
        folds=tuple(folds),
        final_oos_chain_ids=tuple(c.chain_id for c in final_oos_chains),
        final_oos_window=final_oos_window,
        excluded_by_embargo_chain_ids=tuple(dict.fromkeys(excluded_by_embargo)),  # de-duplicated, order-preserving
    )


def assert_no_chain_id_leakage(plan: WalkForwardPlan) -> List[str]:
    """Returns a list of chain_ids that appear in more than one of
    {TRAIN, VALIDATION, FORWARD_TEST} within the SAME fold, or that
    appear in both a rolled fold AND the final OOS segment -- an empty
    list means the plan is leak-free. This is a diagnostic a caller
    should run and assert empty before trusting any fold's results,
    never assumed correct by construction alone."""
    violations: List[str] = []
    final_oos_set = set(plan.final_oos_chain_ids)

    for fold in plan.folds:
        sets = [set(fold.train_chain_ids), set(fold.validation_chain_ids), set(fold.forward_test_chain_ids)]
        for i in range(len(sets)):
            for j in range(i + 1, len(sets)):
                overlap = sets[i] & sets[j]
                if overlap:
                    violations.extend(f"fold {fold.fold_index}: {cid} in two roles" for cid in overlap)
        for role_set in sets:
            overlap_with_oos = role_set & final_oos_set
            if overlap_with_oos:
                violations.extend(f"fold {fold.fold_index}: {cid} also in final OOS" for cid in overlap_with_oos)

    return violations
