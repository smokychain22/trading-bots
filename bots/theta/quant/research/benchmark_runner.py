"""Benchmark execution runner (work package 59).

`benchmarks.json` (loaded via `research/registry.py`'s existing
`load_benchmark_ids()`) is the canonical benchmark ID registry -- this
module does not add a second one. It IS the missing execution layer: no
runner previously existed anywhere in this repo that actually computed a
benchmark's realized/counterfactual metrics against a real dataset.

Only `B0` (cash/WAIT -- "the floor every other family must clear") is
implemented as a genuine runner in this pass. It is the one benchmark
whose outcome is deterministic by construction (no capital deployed, so
the counterfactual after-cost P&L is exactly zero for every episode) and
therefore needs no mechanical-policy simulation engine. Every other
canonical ID (`B3`-`B6`, `BQ-1..3`, `BR-1..2`, `BA-1..3`, `BC-1..2`)
requires simulating a distinct mechanical policy against real market
data and is honestly `RUNNER_NOT_IMPLEMENTED` here, not a fabricated
result -- building each one is its own work package, not a stub.
"""
from __future__ import annotations

from typing import Dict, Sequence
from research.production_export_loader import canonical_json, sha256_hex
from research.empirical_estimators import EstimatorResult, avg_win_avg_loss, max_drawdown, profit_factor, wilson_interval
from research.registry import load_benchmark_ids

IMPLEMENTED_BENCHMARK_IDS = ('B0',)


def _estimator_result_json(result: EstimatorResult) -> dict:
    return {
        'estimate': result.estimate, 'n': result.n, 'effectiveN': result.effective_n,
        'confidenceInterval': list(result.confidence_interval) if result.confidence_interval else None,
        'method': result.method, 'cohort': result.cohort, 'timeRange': list(result.time_range),
        'datasetHash': result.dataset_hash, 'censoredCount': result.censored_count, 'oosState': result.oos_state,
    }


def execute_b0_cash_wait(entry_dataset: dict) -> dict:
    """The floor benchmark: for every episode in the dataset population, the
    counterfactual of holding cash/WAIT deploys zero capital and therefore
    realizes exactly zero after-cost P&L, zero capital-days, zero risk --
    by construction, never by simulation."""
    if entry_dataset.get('version') != 'theta-entry-episode-training-dataset-v1':
        raise ValueError('B0_RUNNER_DATASET_VERSION_UNSUPPORTED')
    rows = entry_dataset['rows']
    n = len(rows)
    if n == 0:
        payload = {'benchmarkId': 'B0', 'state': 'INSUFFICIENT_DATA', 'episodeCount': 0,
                   'datasetHash': entry_dataset['contentHash'], 'metrics': None}
        return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
    zero_pnls = [0.0] * n
    payload = {
        'benchmarkId': 'B0', 'state': 'EXECUTED', 'episodeCount': n,
        'datasetHash': entry_dataset['contentHash'],
        'metrics': {
            'afterCostPnlPerEpisode': zero_pnls, 'meanAfterCostPnl': 0.0, 'capitalDaysDeployed': 0.0,
            'winRate': _estimator_result_json(wilson_interval(0, n, cohort='B0')),
            'profitFactor': profit_factor([], []), 'avgWinAvgLoss': list(avg_win_avg_loss([], [])),
            'maxDrawdown': max_drawdown([1.0] * (n + 1)),
        },
    }
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}


_RUNNERS = {'B0': execute_b0_cash_wait}


def execute_benchmark(benchmark_id: str, entry_dataset: dict) -> dict:
    if benchmark_id not in load_benchmark_ids():
        raise ValueError(f'BENCHMARK_ID_NOT_REGISTERED:{benchmark_id}')
    runner = _RUNNERS.get(benchmark_id)
    if runner is None:
        raise ValueError(f'BENCHMARK_RUNNER_NOT_IMPLEMENTED:{benchmark_id}')
    return runner(entry_dataset)


def coverage_report() -> Dict[str, Sequence[str]]:
    registered = load_benchmark_ids()
    return {
        'registeredBenchmarkIds': sorted(registered),
        'implementedRunnerIds': sorted(set(IMPLEMENTED_BENCHMARK_IDS) & registered),
        'unimplementedRunnerIds': sorted(registered - set(IMPLEMENTED_BENCHMARK_IDS)),
    }
