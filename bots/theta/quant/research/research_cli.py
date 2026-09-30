"""Unified research CLI (work package 83).

Each subcommand is a thin dispatcher to an existing, real, independently-
tested module -- this file never reimplements domain logic. `--input` is a
path to a JSON file holding whatever arguments that module's real function
needs (documented per subcommand below); output is JSON on stdout,
including whatever source/dataset/config hashes the underlying module
already produces. Capabilities whose canonical implementation is TypeScript
return that exact authority path instead of duplicating domain logic in
Python.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from research.historical_v1_to_v6_bridge import convert_historical_export
from research.historical_export_dedupe import HistoricalExportEntry, deduplicate_historical_exports
from research.missingness_engine import build_missingness_report
from research.benchmark_runner import classify_benchmark_readiness, classify_all_benchmarks, execute_benchmark
from research.entry_feature_ablation import execute_entry_feature_ablation
from research.validation import calibration_metrics
from research.selection_bias_runner import run_selection_bias_campaign
from research.reproducibility_bundle import verify_reproducibility_bundle
from research.historical_coverage_report import build_historical_coverage_report
from research.production_export_loader import _load_candidate, load_dataset_export
from research.management_dataset import build_management_dataset
from research.regime_dataset import build_regime_dataset
from research.future_volatility_label import build_future_volatility_label
from research.registry import load_feature_family_ids, validate_registry
from research.failure_attribution import attribute_failure
from research.wait_outcome import T0WaitDecision, build_matured_wait_outcome
from research.wait_analysis import classify_wait_regret
from features.strictness_funnel import StrictnessRow, build_strictness_funnel

CANONICAL_TYPESCRIPT_COMMANDS = {
    'dataset-build': 'tools/theta-research-dataset-cli.ts',
    'filter-value': 'src/research/filter-value-analysis-engine.ts',
}
COMMANDS = (
    'historical-convert', 'historical-dedupe', 'missingness', 'coverage', 'strictness', 'benchmark', 'ablation',
    'calibration', 'selection-bias', 'reproducibility-verify', 'features', 'failure-attribution', 'wait-outcome',
    'management-dataset', 'regime-dataset', 'future-volatility-label', *CANONICAL_TYPESCRIPT_COMMANDS,
)


def _load(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding='utf-8'))


def _dispatch(command: str, payload: dict) -> dict:
    if command == 'future-volatility-label':
        return build_future_volatility_label(payload)
    if command in ('management-dataset', 'regime-dataset'):
        export = load_dataset_export(payload['export'])
        builder = build_management_dataset if command == 'management-dataset' else build_regime_dataset
        return builder(export, payload['policy'])
    if command == 'failure-attribution':
        return attribute_failure(payload)
    if command == 'wait-outcome':
        outcome = build_matured_wait_outcome(T0WaitDecision(**payload['decision']),
            payload['underlyingPriceAtDecision'], payload['underlyingPriceAtMaturation'], payload['maturationTimestamp'],
            payload.get('alternative'), payload.get('observationTruthClass', 'UNKNOWN'))
        return {'outcome': asdict(outcome), 'economicComparison': classify_wait_regret(outcome).value,
                'decisionAssessment': 'NOT_ASSESSED_NO_GATE_OVERRIDE', 'brokerAuthority': False}
    if command == 'historical-convert':
        result = convert_historical_export(payload['raw'])
        return {
            'sourceSchemaVersion': result.source_schema_version, 'sourceHashVerified': result.source_hash_verified,
            'convertedContentHash': result.converted_content_hash, 'candidateCount': len(result.candidates),
        }
    if command == 'historical-dedupe':
        entries = [HistoricalExportEntry(e['directoryPath'], e['manifestText'], e['dataset']) for e in payload['entries']]
        report = deduplicate_historical_exports(entries)
        return dict(report.__dict__)
    if command == 'missingness':
        return build_missingness_report(payload['records'], value_key=payload['valueKey'], dimensions=payload.get('dimensions'))
    if command == 'coverage':
        candidates = [_load_candidate(raw) for raw in payload['candidates']]
        return build_historical_coverage_report(candidates)
    if command == 'strictness':
        rows = [StrictnessRow(r['strategy'], r['date'], r['reasonCode'], r.get('candidateId')) for r in payload['rows']]
        report = build_strictness_funnel(rows)
        return {'totalCount': report.total_count, 'countsByCategory': dict(report.counts_by_category),
                'ratesByCategory': dict(report.rates_by_category)}
    if command == 'benchmark':
        if payload.get('execute') is True:
            return execute_benchmark(payload['benchmarkId'], payload['benchmarkInput'])
        if payload.get('benchmarkId'):
            return classify_benchmark_readiness(payload['benchmarkId'], payload.get('capabilityEvidence'))
        return classify_all_benchmarks(payload.get('capabilityEvidence', {}))
    if command == 'ablation':
        return execute_entry_feature_ablation(payload['dataset'], payload['baselinePolicy'], payload['policy'], payload['generatedAt'])
    if command == 'calibration':
        metrics = calibration_metrics(payload['probabilities'], payload['labels'], payload['binCount'])
        return {'sampleSize': metrics.sample_size, 'brierScore': metrics.brier_score, 'logLoss': metrics.log_loss,
                'expectedCalibrationError': metrics.expected_calibration_error}
    if command == 'selection-bias':
        return run_selection_bias_campaign(payload)
    if command == 'reproducibility-verify':
        return {'verified': verify_reproducibility_bundle(payload['bundle'])}
    if command == 'features':
        validate_registry()
        identifiers = sorted(load_feature_family_ids())
        return {'state': 'REGISTRY_VALID', 'featureFamilyIds': identifiers, 'featureFamilyCount': len(identifiers),
                'brokerAuthority': False}
    if command in CANONICAL_TYPESCRIPT_COMMANDS:
        return {'state': 'CANONICAL_TYPESCRIPT_PATH', 'command': command,
                'implementation': CANONICAL_TYPESCRIPT_COMMANDS[command], 'brokerAuthority': False,
                'reason': 'The canonical implementation is TypeScript; the Python CLI does not duplicate its authority.'}
    raise ValueError(f'RESEARCH_CLI_UNKNOWN_COMMAND:{command}')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=COMMANDS)
    parser.add_argument('--input', required=True)
    arguments = parser.parse_args()
    result = _dispatch(arguments.command, _load(arguments.input))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
