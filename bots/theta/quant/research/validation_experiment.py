"""Offline R8E/F executor. No broker imports, activation, or invented labels.

Consumes a content-addressed timing manifest plus dated out-of-training scores.
Emits purged folds, fitted calibration artifacts and forward-only metrics.
The base model remains caller supplied, with training membership verified here.
"""
from __future__ import annotations

import argparse
from dataclasses import asdict
from datetime import datetime
import hashlib
import json
from math import isfinite
from pathlib import Path
import subprocess

from research.validation import (PitValidationObservation, WalkForwardConfig,
    build_purged_walk_forward_plan, calibration_metrics, fit_isotonic_calibrator,
    fit_platt_scaler)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def execute_validation_experiment(raw):
    if raw.get('version') != 'theta-validation-experiment-input-v1':
        raise ValueError('INVALID_VALIDATION_EXPERIMENT_VERSION')
    if raw.get('evidenceClass') not in ('REAL_PERSISTED', 'DETERMINISTIC_TEST'):
        raise ValueError('EXPLICIT_EVIDENCE_CLASS_REQUIRED')
    observations = raw['observations']
    if digest(observations) != raw['observationManifestHash']:
        raise ValueError('OBSERVATION_MANIFEST_HASH_MISMATCH')
    plan = build_purged_walk_forward_plan([PitValidationObservation(**r) for r in observations],
        WalkForwardConfig(**raw['splitConfig']), raw['embargoSeconds'], raw['policyVersion'])
    minimum = raw['minimumCalibrationSamples']
    bins = raw['calibrationBins']
    if type(minimum) is not int or minimum <= 0 or type(bins) is not int or bins <= 0:
        raise ValueError('EXPLICIT_CALIBRATION_POLICY_REQUIRED')
    by_id = {r['observation_id']: r for r in observations}
    scores = raw['predictions']
    if digest(scores) != raw['predictionManifestHash']:
        raise ValueError('PREDICTION_MANIFEST_HASH_MISMATCH')
    folds = []
    for split in plan.plan.splits:
        train = set(split.train_ids)
        needed = set(split.validation_ids + split.forward_ids)
        selected = {identity: scores.get(identity) for identity in needed}
        reasons = []
        model_identities = set()
        for identity, prediction in selected.items():
            if prediction is None:
                reasons.append('PREDICTION_NOT_AVAILABLE')
                continue
            if not prediction.get('modelVersion') or not prediction.get('evidenceId'):
                raise ValueError('PREDICTION_LINEAGE_REQUIRED')
            training = prediction.get('trainingObservationIds')
            if not training or len(set(training)) != len(training) or not set(training).issubset(train):
                raise ValueError('MODEL_TRAINING_OUTSIDE_PURGED_TRAIN_SPLIT')
            model_identities.add((prediction['modelVersion'], tuple(sorted(training))))
            decision = datetime.fromisoformat(by_id[identity]['observed_at'].replace('Z', '+00:00'))
            available = datetime.fromisoformat(prediction['availableAt'].replace('Z', '+00:00'))
            if available.tzinfo is None or available > decision:
                raise ValueError('PREDICTION_NOT_PIT_AVAILABLE')
            if not isfinite(prediction['score']) or type(prediction['label']) is not int or prediction['label'] not in (0, 1):
                raise ValueError('INVALID_PREDICTION_OR_LABEL')
        if len(model_identities) > 1:
            raise ValueError('CALIBRATION_MODEL_IDENTITY_MISMATCH')
        if reasons:
            folds.append({'split': asdict(split), 'state': 'FORWARD_DATA_REQUIRED', 'reasons': sorted(set(reasons))})
            continue
        calibration_scores = [selected[i]['score'] for i in split.validation_ids]
        calibration_labels = [selected[i]['label'] for i in split.validation_ids]
        models = {'PLATT': fit_platt_scaler(calibration_scores, calibration_labels, minimum),
                  'ISOTONIC': fit_isotonic_calibrator(calibration_scores, calibration_labels, minimum)}
        outcomes = {}
        for name, model in models.items():
            if model is None:
                outcomes[name] = {'state': 'CALIBRATION_NOT_READY', 'model': None, 'metrics': None}
            else:
                probabilities = [model.predict(selected[i]['score']) for i in split.forward_ids]
                labels = [selected[i]['label'] for i in split.forward_ids]
                outcomes[name] = {'state': 'FORWARD_EVALUATED', 'model': asdict(model),
                                  'metrics': asdict(calibration_metrics(probabilities, labels, bins))}
        folds.append({'split': asdict(split), 'state': 'EXECUTED', 'calibration': outcomes,
                      'baseModelVersion': next(iter(model_identities))[0]})
    result = {'version': 'theta-validation-experiment-v1', 'sourceSha': raw['sourceSha'],
              'evidenceClass': raw['evidenceClass'], 'inputHash': digest(raw), 'plan': asdict(plan), 'folds': folds,
              'finalOosEvaluated': False, 'brokerAuthority': False, 'modelPromoted': False,
              'state': 'EXECUTED' if folds and all(f['state'] == 'EXECUTED' for f in folds) else 'INSUFFICIENT_ELIGIBLE_EVIDENCE',
              'profitability': 'EMPIRICALLY_UNPROVEN'}
    return {**result, 'contentHash': digest(result)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    raw = json.loads(Path(args.input).read_text(encoding='utf-8'))
    sha = raw['sourceSha']
    if len(sha) != 40 or any(c not in '0123456789abcdef' for c in sha):
        raise ValueError('INVALID_CANONICAL_SOURCE_SHA')
    subprocess.run(['git', 'merge-base', '--is-ancestor', sha, 'origin/main'], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    receipt = execute_validation_experiment(raw)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open('x', encoding='utf-8') as handle:
        handle.write(json.dumps(receipt, indent=2, sort_keys=True, allow_nan=False))
    print(json.dumps({'state': 'RESEARCH_EXECUTED', 'contentHash': receipt['contentHash'],
                      'folds': len(receipt['folds']), 'modelPromoted': False, 'brokerMutations': 0}))


if __name__ == '__main__':
    main()
