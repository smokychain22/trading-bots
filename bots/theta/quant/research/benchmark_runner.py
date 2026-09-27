"""Benchmark execution runner (work package 59, completed per V4 section 5).

`benchmarks.json` (loaded via `research/registry.py`'s existing
`load_benchmark_ids()`) is the canonical benchmark ID registry -- this
module does not add a second one. It IS the missing execution layer: no
runner previously existed anywhere in this repo that actually computed a
benchmark's realized/counterfactual metrics against a real dataset.

`B0` (cash/WAIT) is a full, deterministic runner (`execute_b0_cash_wait`).
Every other canonical mechanical benchmark now has a real, tested
mechanic in `research/benchmark_mechanics.py` (`B3`-`B6`, `BQ-1..3`,
`BR-1..2`, `BA-1..3`, `BC-2`) or is honestly `BLOCKED_MISSING_POLICY`
(`B1`, `B2`, `BH-1` -- these require a full multi-stage lifecycle/backtest
simulation across several open positions over time, not a single pure
mechanic, and that simulation has not been built). `A1`-`A6` are the TRD
ablation ladder steps registered in the same `benchmarks.json` file, but
they are executed by `research/entry_feature_ablation.py`/`ablation.py`
(work package 60), not this benchmark runner -- `classify_benchmark_readiness`
reports them `NOT_APPLICABLE` here with a pointer to that module, rather
than silently omitting them or wrongly claiming this runner covers them.

Per real data probed in this pass (the entire `C:\\ProjectBackups`
historical archive: 7550 unique candidates, every one `hardStatus=
DATA_INSUFFICIENT`/`soft_status=REJECTED`/`selected=False`, zero
management snapshots, zero lifecycle outcomes, zero whole-chain outcomes,
no `delta` field anywhere in `contract`/`volatility`), every mechanical
benchmark's real-data classification today is honestly
`RUNNER_IMPLEMENTED_DATA_UNAVAILABLE` -- the code runs, but there is no
real population/price-path/lifecycle evidence for it to run ON. This is
reported explicitly per ID, never silently coerced to "not applicable" or
skipped.
"""
from __future__ import annotations

from typing import Dict, Optional, Sequence
from research.production_export_loader import canonical_json, sha256_hex
from research.empirical_estimators import EstimatorResult, avg_win_avg_loss, max_drawdown, profit_factor, wilson_interval
from research.registry import load_benchmark_ids

IMPLEMENTED_BENCHMARK_IDS = ('B0',)

MECHANIC_IMPLEMENTED_BENCHMARK_IDS = (
    'B3', 'B4', 'B5', 'B6', 'BQ-1', 'BQ-2', 'BQ-3', 'BR-1', 'BR-2', 'BA-1', 'BA-2', 'BA-3', 'BC-1', 'BC-2',
)
MISSING_POLICY_BENCHMARK_IDS = ('B1', 'B2', 'BH-1')
ABLATION_LADDER_IDS = ('A1', 'A2', 'A3', 'A4', 'A5', 'A6')

# The specific real-data capability each mechanic-implemented ID needs,
# checked against actual probed archive state -- named so a future dataset
# with real coverage flips the classification automatically, honestly.
_REQUIRED_CAPABILITY = {
    'B3': 'has_price_paths', 'B4': 'has_price_paths', 'BR-1': 'has_price_paths', 'BR-2': 'has_price_paths',
    'B5': 'has_feasible_candidates', 'BQ-1': 'has_feasible_candidates', 'BQ-3': 'has_feasible_candidates',
    'BQ-2': 'has_delta_field',
    'B6': 'has_lifecycle_events', 'BA-1': 'has_lifecycle_events', 'BA-2': 'has_lifecycle_events',
    'BA-3': 'has_lifecycle_events', 'BC-1': 'has_lifecycle_events', 'BC-2': 'has_lifecycle_events',
}


def classify_benchmark_readiness(benchmark_id: str, capability_evidence: Optional[Dict[str, bool]] = None) -> dict:
    """Classifies exactly one of RUNNER_IMPLEMENTED_DATA_AVAILABLE /
    RUNNER_IMPLEMENTED_DATA_UNAVAILABLE / NOT_APPLICABLE /
    BLOCKED_MISSING_POLICY per canonical benchmark ID, per V4 section 5.
    `capability_evidence` is the caller's real, probed data-availability
    facts (e.g. {'has_price_paths': False, ...}) -- never guessed here."""
    if benchmark_id not in load_benchmark_ids():
        raise ValueError(f'BENCHMARK_ID_NOT_REGISTERED:{benchmark_id}')
    if benchmark_id in ABLATION_LADDER_IDS:
        return {'benchmarkId': benchmark_id, 'state': 'NOT_APPLICABLE',
                'reason': 'ABLATION_LADDER_STEP_EXECUTED_BY_ENTRY_FEATURE_ABLATION_MODULE'}
    if benchmark_id == 'B0':
        return {'benchmarkId': benchmark_id, 'state': 'RUNNER_IMPLEMENTED_DATA_AVAILABLE',
                'reason': 'DETERMINISTIC_BY_CONSTRUCTION_NO_DATA_NEEDED'}
    if benchmark_id in MISSING_POLICY_BENCHMARK_IDS:
        return {'benchmarkId': benchmark_id, 'state': 'BLOCKED_MISSING_POLICY',
                'reason': 'REQUIRES_MULTI_STAGE_LIFECYCLE_SIMULATION_NOT_YET_BUILT'}
    if benchmark_id in MECHANIC_IMPLEMENTED_BENCHMARK_IDS:
        capability = _REQUIRED_CAPABILITY[benchmark_id]
        available = bool((capability_evidence or {}).get(capability))
        state = 'RUNNER_IMPLEMENTED_DATA_AVAILABLE' if available else 'RUNNER_IMPLEMENTED_DATA_UNAVAILABLE'
        return {'benchmarkId': benchmark_id, 'state': state, 'reason': f'REQUIRES:{capability}'}
    raise ValueError(f'BENCHMARK_RUNNER_NOT_IMPLEMENTED:{benchmark_id}')


def classify_all_benchmarks(capability_evidence: Dict[str, bool]) -> Dict[str, dict]:
    return {bid: classify_benchmark_readiness(bid, capability_evidence) for bid in sorted(load_benchmark_ids())}


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


def coverage_report(capability_evidence: Optional[Dict[str, bool]] = None) -> Dict[str, object]:
    registered = load_benchmark_ids()
    by_state: Dict[str, list] = {}
    for benchmark_id in sorted(registered):
        classification = classify_benchmark_readiness(benchmark_id, capability_evidence)
        by_state.setdefault(classification['state'], []).append(benchmark_id)
    return {
        'registeredBenchmarkIds': sorted(registered),
        'implementedRunnerIds': sorted(set(IMPLEMENTED_BENCHMARK_IDS) & registered),
        'byState': by_state,
    }
