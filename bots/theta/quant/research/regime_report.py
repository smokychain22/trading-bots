"""Regime-breakdown reporter for THETA's Full-H economics (R6D).

Groups already-computed episode records into caller-defined regime cells
(bull/bear/sideways, vol regime, underlying, sector, strategy branch, DTE/
delta/IV bucket, event/non-event, assignment outcome, flow state -- any
dimension the caller supplies a key function for) and reports each cell's
own N and metrics SEPARATELY -- never one blended global number. A cell
below the caller-supplied minimum independent N reports its N honestly but
withholds its metrics (None, never a number computed from too few
observations to trust), per the standing "no strong claims from tiny
cells" instruction.

No I/O, no provider dependency -- pure functions over caller-supplied
already-computed episode records, exercised only against synthetic
fixtures until real resolved episodes exist (EV_MODEL_NOT_EMPIRICALLY_
READY, unchanged).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Hashable, List, Optional, Sequence, TypeVar

T = TypeVar("T")


@dataclass(frozen=True)
class EpisodeRecord:
    """One resolved episode's already-computed economics -- the minimal
    shape this reporter needs. `chain_id` is the independence unit (per
    `walk_forward.py`'s own grouping discipline): several EpisodeRecords
    sharing a `chain_id` are the SAME economic chain observed at different
    points, not independent observations."""

    chain_id: str
    pnl: float
    capital_days: Optional[float]


@dataclass(frozen=True)
class RegimeCell:
    cell_key: Hashable
    raw_n: int
    independent_chain_n: int  # count of DISTINCT chain_id within this cell -- never conflated with raw_n
    ev_net: Optional[float]
    return_per_capital_day: Optional[float]
    win_rate: Optional[float]
    avg_win: Optional[float]
    avg_loss: Optional[float]
    insufficient_n: bool  # True when independent_chain_n < the caller's own min_independent_chain_n
    note: str


def build_regime_report(
    episodes: Sequence[EpisodeRecord],
    cell_key_fn: Callable[[EpisodeRecord], Hashable],
    min_independent_chain_n: int,
) -> List[RegimeCell]:
    """Groups `episodes` by `cell_key_fn` (e.g. a tuple of regime/DTE-
    bucket/underlying/etc. labels the caller derives per episode) and
    reports each cell's own N and metrics. `min_independent_chain_n` is
    REQUIRED, caller-supplied -- never a hardcoded default, per the
    standing "no arbitrary financial threshold without justification"
    instruction; a cell below it still reports its raw_n/independent_
    chain_n honestly (never hidden) but every metric is None and
    `insufficient_n=True`, so a tiny cell can never masquerade as a
    confident result."""
    groups: Dict[Hashable, List[EpisodeRecord]] = {}
    for episode in episodes:
        groups.setdefault(cell_key_fn(episode), []).append(episode)

    cells: List[RegimeCell] = []
    for key, group in groups.items():
        raw_n = len(group)
        independent_chain_n = len({e.chain_id for e in group})

        if independent_chain_n < min_independent_chain_n:
            cells.append(RegimeCell(
                cell_key=key, raw_n=raw_n, independent_chain_n=independent_chain_n,
                ev_net=None, return_per_capital_day=None, win_rate=None, avg_win=None, avg_loss=None,
                insufficient_n=True,
                note=f"independent_chain_n={independent_chain_n} below the required minimum {min_independent_chain_n} -- no metric reported",
            ))
            continue

        pnls = [e.pnl for e in group]
        ev_net = sum(pnls) / len(pnls)
        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p <= 0]
        win_rate = len(wins) / len(pnls)
        avg_win = (sum(wins) / len(wins)) if wins else None
        avg_loss = (sum(losses) / len(losses)) if losses else None

        capital_day_pairs = [(e.pnl, e.capital_days) for e in group if e.capital_days is not None and e.capital_days > 0]
        return_per_capital_day = (
            sum(p / cd for p, cd in capital_day_pairs) / len(capital_day_pairs)
            if capital_day_pairs else None
        )

        cells.append(RegimeCell(
            cell_key=key, raw_n=raw_n, independent_chain_n=independent_chain_n,
            ev_net=ev_net, return_per_capital_day=return_per_capital_day,
            win_rate=win_rate, avg_win=avg_win, avg_loss=avg_loss,
            insufficient_n=False, note="",
        ))

    return cells


def count_distinct_chains(episodes: Sequence[EpisodeRecord]) -> int:
    """The single most important dependence-awareness number: how many
    INDEPENDENT chains, not how many raw episode rows. `len(episodes)` on
    its own answers a different, misleading question."""
    return len({e.chain_id for e in episodes})


def count_same_key_clusters(items: Sequence[T], cluster_key_fn: Callable[[T], Hashable]) -> int:
    """Counts distinct clusters under an arbitrary dependence key (e.g. a
    (date, underlying) pair, or a (date, sector) pair) -- the general tool
    behind "10 SPY trades on one event day is not 10 independent
    observations": pass `cluster_key_fn = lambda e: (e.date, e.underlying)`
    and this returns how many genuinely distinct (date, underlying)
    clusters exist, which is the number that actually bears on effective
    sample size, not the raw item count."""
    return len({cluster_key_fn(item) for item in items})
