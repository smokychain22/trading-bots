"""Benchmark execution runner (work package 59, completed per V4 section 5).

`benchmarks.json` (loaded via `research/registry.py`'s existing
`load_benchmark_ids()`) is the canonical benchmark ID registry -- this
module does not add a second one. It IS the missing execution layer: no
runner previously existed anywhere in this repo that actually computed a
benchmark's realized/counterfactual metrics against a real dataset.

`B0` (cash/WAIT) is a full, deterministic runner (`execute_b0_cash_wait`).
Every other canonical mechanical benchmark now has a real, tested
mechanic and dispatcher in `research/benchmark_mechanics.py` and this module
(`B3`-`B6`, `BQ-1..2`, `BR-1..2`, `BA-1..3`, `BC-1..2`) or is honestly
`BLOCKED_MISSING_POLICY` (`B1`, `B2`, `BH-1`). The lifecycle benchmarks
require a full multi-stage simulation across positions. `BQ-3` uses the
already-frozen `theta_q_contract.evaluate_request` boundary, so the runner
executes the exact transparent v0 baseline without reimplementing or silently
changing its policy. `A1`-`A6` are the TRD
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
from research.benchmark_mechanics import (
    buy_and_hold_return, closest_delta_selection, covered_call_max_yield_selection,
    fixed_capture_exit, fixed_time_exit, hold_to_expiry_outcome,
    immediate_cc_after_assignment, mechanical_assignment_response,
    random_eligible_selection, select_by_metric,
    unconditional_hold_to_basis_recovery,
)
from runtime.theta_q_contract import evaluate_request as evaluate_theta_q_v0

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
    'B5': 'has_feasible_candidates', 'BQ-1': 'has_feasible_candidates',
    'BQ-2': 'has_delta_field',
    'BQ-3': 'has_theta_q_v0_inputs',
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
        reason = 'REQUIRES_MULTI_STAGE_LIFECYCLE_SIMULATION_NOT_YET_BUILT'
        return {'benchmarkId': benchmark_id, 'state': 'BLOCKED_MISSING_POLICY',
                'reason': reason}
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


def _executed(benchmark_id: str, benchmark_input: dict, result: object) -> dict:
    payload = {
        'benchmarkId': benchmark_id, 'state': 'EXECUTED',
        'inputHash': sha256_hex(canonical_json(benchmark_input)), 'result': result,
        'brokerAuthority': False, 'empiricalPromotion': False,
    }
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}


def _require(payload: dict, *names: str) -> None:
    missing = [name for name in names if name not in payload]
    if missing:
        raise ValueError(f'BENCHMARK_INPUT_MISSING:{missing[0]}')


def _execute_mechanical(benchmark_id: str, payload: dict) -> dict:
    if not isinstance(payload.get('policyVersion'), str) or not payload['policyVersion'].strip():
        raise ValueError('BENCHMARK_POLICY_VERSION_REQUIRED')
    if benchmark_id == 'B3':
        _require(payload, 'entryCredit', 'pricePath', 'captureFraction')
        result = fixed_capture_exit(payload['entryCredit'], payload['pricePath'], payload['captureFraction'])
    elif benchmark_id == 'B4':
        _require(payload, 'entryCredit', 'pricePath', 'holdBars')
        result = fixed_time_exit(payload['pricePath'], payload['entryCredit'], payload['holdBars'])
    elif benchmark_id == 'B5':
        _require(payload, 'candidates', 'seed')
        result = random_eligible_selection(payload['candidates'], payload['seed'])
    elif benchmark_id == 'B6':
        _require(payload, 'entryPrice', 'exitPrice')
        result = {'return': buy_and_hold_return(payload['entryPrice'], payload['exitPrice'])}
    elif benchmark_id == 'BQ-1':
        _require(payload, 'candidates', 'metricKey', 'higherIsBetter')
        if payload['metricKey'] not in ('entryPremium', 'ivRank'):
            raise ValueError('BENCHMARK_BQ1_METRIC_NOT_PRE_REGISTERED')
        result = select_by_metric(payload['candidates'], payload['metricKey'], payload['higherIsBetter'])
    elif benchmark_id == 'BQ-2':
        _require(payload, 'candidates', 'targetDelta')
        result = closest_delta_selection(payload['candidates'], payload['targetDelta'])
    elif benchmark_id == 'BQ-3':
        _require(payload, 'request')
        result = evaluate_theta_q_v0(payload['request'])
    elif benchmark_id == 'BR-1':
        _require(payload, 'entryCredit', 'underlyingPriceAtExpiration', 'strike')
        result = hold_to_expiry_outcome(payload['entryCredit'], payload['underlyingPriceAtExpiration'], payload['strike'])
    elif benchmark_id == 'BR-2':
        _require(payload, 'entryCredit', 'pricePath')
        result = fixed_capture_exit(payload['entryCredit'], payload['pricePath'], 0.5)
    elif benchmark_id == 'BA-1':
        _require(payload, 'assigned')
        result = {'action': mechanical_assignment_response(payload['assigned'], 'BA1_CLOSE_BEFORE_ASSIGNMENT')}
    elif benchmark_id == 'BA-2':
        _require(payload, 'originalBasis', 'currentPrice')
        result = unconditional_hold_to_basis_recovery(payload['originalBasis'], payload['currentPrice'])
    elif benchmark_id == 'BA-3':
        _require(payload, 'assigned')
        result = {'action': mechanical_assignment_response(payload['assigned'], 'BA3_UNCONDITIONAL_ACCEPT')}
    elif benchmark_id == 'BC-1':
        _require(payload, 'candidates')
        result = covered_call_max_yield_selection(payload['candidates'])
    elif benchmark_id == 'BC-2':
        _require(payload, 'assigned')
        result = {'action': immediate_cc_after_assignment(payload['assigned'])}
    else:
        raise ValueError(f'BENCHMARK_RUNNER_NOT_IMPLEMENTED:{benchmark_id}')
    return _executed(benchmark_id, payload, result)


def execute_benchmark(benchmark_id: str, benchmark_input: dict) -> dict:
    if benchmark_id not in load_benchmark_ids():
        raise ValueError(f'BENCHMARK_ID_NOT_REGISTERED:{benchmark_id}')
    if benchmark_id == 'B0':
        return execute_b0_cash_wait(benchmark_input)
    if benchmark_id in MISSING_POLICY_BENCHMARK_IDS:
        raise ValueError(f'BENCHMARK_BLOCKED_MISSING_POLICY:{benchmark_id}')
    if benchmark_id in ABLATION_LADDER_IDS:
        raise ValueError(f'BENCHMARK_EXECUTION_NOT_APPLICABLE_USE_ABLATION_RUNNER:{benchmark_id}')
    return _execute_mechanical(benchmark_id, benchmark_input)


def coverage_report(capability_evidence: Optional[Dict[str, bool]] = None) -> Dict[str, object]:
    registered = load_benchmark_ids()
    by_state: Dict[str, list] = {}
    for benchmark_id in sorted(registered):
        classification = classify_benchmark_readiness(benchmark_id, capability_evidence)
        by_state.setdefault(classification['state'], []).append(benchmark_id)
    return {
        'registeredBenchmarkIds': sorted(registered),
        'implementedRunnerIds': sorted((set(IMPLEMENTED_BENCHMARK_IDS) | set(MECHANIC_IMPLEMENTED_BENCHMARK_IDS)) & registered),
        'byState': by_state,
    }
