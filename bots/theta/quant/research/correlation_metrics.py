"""Correlation/concentration research metrics for THETA (R6B).

THETA should not treat five different tickers as five independent risks
when they move together. This module computes point-in-time-safe return
correlation and groups underlyings into concentration clusters --
informed by `HasibVortex369/riskkit`'s `CorrelationGuard` pattern
(static + dynamic groups, reviewed this session, `ADAPT` -- pandas-
dependent there, reimplemented dependency-free here) but built as a
RESEARCH metric, not a production risk gate: this module does not enforce
"at most one position per correlation group," it only measures and
reports clustering so AEGIS integration can be a later, deliberate,
validated decision (per the explicit instruction that correlation/
concentration research must not silently become a Production risk limit
in this phase).

No I/O, no provider dependency -- pure functions over already-fetched
return series, exercised only against synthetic fixtures.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, FrozenSet, List, Optional, Sequence, Tuple


@dataclass(frozen=True)
class ReturnSeries:
    """One underlying's own return observations, already point-in-time
    joined by the caller (via `point_in_time_join.py` -- this module
    does not perform its own date alignment across symbols beyond
    requiring the caller supply equal-length, already-aligned series)."""

    symbol: str
    returns: Tuple[float, ...]


def pairwise_correlation(a: Sequence[float], b: Sequence[float]) -> Optional[float]:
    """Pearson correlation coefficient. Returns None (never a fabricated
    0 or 1) when the two series have different lengths (an alignment bug
    the caller must fix, not silently truncate), fewer than 2
    observations, or either series has zero variance (a constant series
    has an undefined correlation, not 0)."""
    if len(a) != len(b):
        return None
    n = len(a)
    if n < 2:
        return None

    mean_a = sum(a) / n
    mean_b = sum(b) / n
    cov = sum((a[i] - mean_a) * (b[i] - mean_b) for i in range(n))
    var_a = sum((x - mean_a) ** 2 for x in a)
    var_b = sum((x - mean_b) ** 2 for x in b)

    if var_a == 0 or var_b == 0:
        return None

    return cov / ((var_a ** 0.5) * (var_b ** 0.5))


@dataclass(frozen=True)
class CorrelationMatrix:
    symbols: Tuple[str, ...]
    values: Dict[Tuple[str, str], Optional[float]]  # (symbol_a, symbol_b) -> correlation, symmetric, None where unknown

    def get(self, symbol_a: str, symbol_b: str) -> Optional[float]:
        if symbol_a == symbol_b:
            return 1.0
        # A genuine zero correlation is a real, valid value -- `or` is
        # wrong here because 0.0 is falsy in Python, so `values.get((a,b))
        # or values.get((b,a))` would silently fall through to the second
        # (symmetric, also-missing) lookup and return None for an actual
        # zero correlation instead of 0.0. Codex review flagged this.
        # Explicit `is not None` checks make an actually-known zero
        # correlation distinguishable from a genuinely unknown pair.
        direct = self.values.get((symbol_a, symbol_b))
        if direct is not None:
            return direct
        return self.values.get((symbol_b, symbol_a))


def build_correlation_matrix(series: Sequence[ReturnSeries]) -> CorrelationMatrix:
    """Builds the full pairwise correlation matrix across the supplied
    return series. A pair whose correlation is unknown (misaligned
    lengths, zero variance) is simply absent from `values` -- `get`
    returns None for it, never a fabricated 0."""
    symbols = tuple(s.symbol for s in series)
    values: Dict[Tuple[str, str], Optional[float]] = {}
    for i in range(len(series)):
        for j in range(i + 1, len(series)):
            corr = pairwise_correlation(series[i].returns, series[j].returns)
            if corr is not None:
                values[(series[i].symbol, series[j].symbol)] = corr
    return CorrelationMatrix(symbols=symbols, values=values)


def dynamic_correlation_clusters(
    matrix: CorrelationMatrix,
    threshold: float,
) -> List[FrozenSet[str]]:
    """Groups symbols into clusters via single-linkage clustering on
    |correlation| >= threshold (mirroring riskkit's own dynamic-grouping
    rule, reimplemented dependency-free). Returns a list of disjoint
    symbol sets -- every symbol appears in exactly one cluster, including
    singleton clusters for a symbol correlated with nothing above
    threshold. `threshold` is REQUIRED, caller-supplied -- never a
    hardcoded default, per the standing "no arbitrary financial
    threshold without justification" instruction (riskkit's own default
    of 0.75 is cited only as a reference point in the research ledger,
    never silently reused here as this module's own default).
    """
    if not (0.0 <= threshold <= 1.0):
        raise ValueError(f"threshold must be in [0, 1], got {threshold}")

    parent: Dict[str, str] = {symbol: symbol for symbol in matrix.symbols}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x: str, y: str) -> None:
        root_x, root_y = find(x), find(y)
        if root_x != root_y:
            parent[root_x] = root_y

    for (a, b), corr in matrix.values.items():
        if corr is not None and abs(corr) >= threshold:
            union(a, b)

    clusters: Dict[str, List[str]] = {}
    for symbol in matrix.symbols:
        root = find(symbol)
        clusters.setdefault(root, []).append(symbol)

    return [frozenset(members) for members in clusters.values()]


@dataclass(frozen=True)
class ConcentrationExposure:
    symbol: str
    capital_committed: float


@dataclass(frozen=True)
class ClusterExposure:
    cluster: FrozenSet[str]
    total_capital: float
    concentration_pct: float  # total_capital / total portfolio capital, across ALL clusters


def cluster_concentration(
    exposures: Sequence[ConcentrationExposure],
    clusters: Sequence[FrozenSet[str]],
) -> List[ClusterExposure]:
    """Maps per-symbol capital exposure onto correlation clusters,
    reporting each cluster's TOTAL committed capital as a fraction of the
    whole portfolio -- the concentration measure that matters when
    several "different" positions are really one correlated bet, per the
    explicit "five tickers is not five independent risks" instruction.
    A symbol with exposure but not present in any supplied cluster
    contributes to no reported cluster (never silently dropped from the
    total, but also never guessed into an arbitrary cluster)."""
    exposure_by_symbol = {e.symbol: e.capital_committed for e in exposures}
    total_capital = sum(exposure_by_symbol.values())

    results: List[ClusterExposure] = []
    for cluster in clusters:
        cluster_capital = sum(exposure_by_symbol.get(symbol, 0.0) for symbol in cluster)
        concentration_pct = (cluster_capital / total_capital) if total_capital > 0 else 0.0
        results.append(ClusterExposure(cluster=cluster, total_capital=cluster_capital, concentration_pct=concentration_pct))
    return results
