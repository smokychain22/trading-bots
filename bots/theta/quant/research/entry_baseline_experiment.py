"""Dataset-bound CSP baseline fitting, calibration, forward replay and registry.

These are retrospective research fits, never historical deployed predictions.
The shared logistic optimizer is mathematical machinery only. This runner sets
the distinct WHOLE_CHAIN_AFTER_COST_POSITIVE target and never calls it severe
drawdown, managed-episode POP, Production EV or a promoted policy.
"""
from dataclasses import asdict
from math import isfinite, sqrt
from calibration.severe_drawdown_logistic_baseline import LogisticTrainingRow, fit_logistic_regression, predict_probability
from research.production_export_loader import canonical_json, sha256_hex
from research.entry_episode_training import timestamp, finite
from research.validation import PitValidationObservation, WalkForwardConfig, build_purged_walk_forward_plan, \
    calibration_metrics, fit_isotonic_calibrator, fit_platt_scaler


def plain(value):
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)):
        return [plain(v) for v in value]
    return value


def hashed(value):
    return sha256_hex(canonical_json(plain(value)))


def execute_entry_baseline(dataset, policy, generated_at):
    if dataset.get('version') != 'theta-entry-episode-training-dataset-v1' \
            or hashed({k: v for k, v in dataset.items() if k != 'contentHash'}) != dataset.get('contentHash'):
        raise ValueError('ENTRY_BASELINE_DATASET_HASH_OR_VERSION_INVALID')
    if policy.get('version') != 'theta-entry-baseline-policy-v1' or not policy.get('policyId'):
        raise ValueError('ENTRY_BASELINE_POLICY_REQUIRED')
    generated = timestamp(generated_at)
    frozen = timestamp(policy['frozenAt'])
    split_config = policy['splitConfig']
    if any(type(v) is not int for v in split_config.values()):
        raise ValueError('ENTRY_BASELINE_INTEGER_SPLIT_REQUIRED')
    for key in ('minimumTrainingRows', 'minimumClassRows', 'minimumCalibrationRows', 'calibrationBins'):
        if type(policy.get(key)) is not int or policy[key] <= 0:
            raise ValueError('ENTRY_BASELINE_MINIMUM_POLICY_REQUIRED')
    rows = dataset['rows']
    by_id = {r['observationId']: r for r in rows}
    if len(by_id) != len(rows) or dataset.get('rowCount') != len(rows):
        raise ValueError('ENTRY_BASELINE_DUPLICATE_IDENTITY')
    for row in rows:
        if frozen > timestamp(row['decisionAt']):
            raise ValueError('ENTRY_BASELINE_POLICY_NOT_PREREGISTERED')
        if timestamp(row['labelAvailableAt']) > generated:
            raise ValueError('ENTRY_BASELINE_LABEL_NOT_YET_AVAILABLE')
        if len(row['features']) != len(dataset['featureNames']) or not row['features'] \
                or any(not finite(v) for v in row['features']) \
                or type(row['positiveWholeChainLabel']) is not int or row['positiveWholeChainLabel'] not in (0, 1):
            raise ValueError('ENTRY_BASELINE_FEATURE_OR_LABEL_INVALID')
    plan = build_purged_walk_forward_plan([PitValidationObservation(
        r['observationId'], r['dependencyGroupId'], r['decisionAt'], r['featureAvailableAt'],
        r['labelAvailableAt'], r['labelWindowEnd']) for r in rows],
        WalkForwardConfig(**split_config), policy['embargoSeconds'], policy['policyId'])
    folds, registry = [], []
    for number, split in enumerate(plan.plan.splits):
        train = [by_id[i] for i in split.train_ids]
        labels = [r['positiveWholeChainLabel'] for r in train]
        if len(train) < policy['minimumTrainingRows'] or min(labels.count(0), labels.count(1)) < policy['minimumClassRows']:
            folds.append({'fold': number, 'state': 'INSUFFICIENT_TRAINING_CLASSES', 'split': asdict(split)})
            continue
        width = len(dataset['featureNames'])
        means = [sum(r['features'][i] for r in train) / len(train) for i in range(width)]
        scales = [sqrt(sum((r['features'][i] - means[i]) ** 2 for r in train) / len(train)) for i in range(width)]
        constant = [i for i, scale in enumerate(scales) if scale == 0]
        # Constant training dimensions contribute zero at all subsequent points.
        # Do not learn a scale from the validation, forward or final OOS rows.
        def vector(row):
            return tuple(0.0 if i in constant else (row['features'][i] - means[i]) / scales[i] for i in range(width))
        fit = fit_logistic_regression([LogisticTrainingRow(vector(r), r['positiveWholeChainLabel']) for r in train], **policy['optimizer'])
        if not fit.converged:
            folds.append({'fold': number, 'state': 'OPTIMIZER_NOT_CONVERGED', 'split': asdict(split)})
            continue
        model = {'version': 'theta-csp-entry-logistic-baseline-v1', 'target': 'WHOLE_CHAIN_AFTER_COST_POSITIVE',
            'generatedAt': generated_at, 'datasetHash': dataset['contentHash'], 'policyHash': hashed(policy),
            'trainIds': list(split.train_ids), 'featureNames': dataset['featureNames'],
            'featureUnits': dataset['featureUnits'], 'means': means, 'scales': scales,
            'constantFeatureIndices': constant, 'fit': asdict(fit),
            'brokerAuthority': False, 'status': 'RESEARCH_FIT_NOT_PROMOTED'}
        model_id = hashed(model)
        scores = {i: predict_probability(fit, vector(by_id[i])) for i in (*split.validation_ids, *split.forward_ids)}
        calibration_scores = [scores[i] for i in split.validation_ids]
        calibration_labels = [by_id[i]['positiveWholeChainLabel'] for i in split.validation_ids]
        forward_labels = [by_id[i]['positiveWholeChainLabel'] for i in split.forward_ids]
        calibrators = {'PLATT': fit_platt_scaler(calibration_scores, calibration_labels, policy['minimumCalibrationRows']),
            'ISOTONIC': fit_isotonic_calibrator(calibration_scores, calibration_labels, policy['minimumCalibrationRows'])}
        calibrated = {}
        for name, calibrator in calibrators.items():
            calibrated[name] = {'state': 'INSUFFICIENT_CALIBRATION_EVIDENCE', 'model': None, 'metrics': None} if calibrator is None else {
                'state': 'FORWARD_EVALUATED', 'model': asdict(calibrator),
                'metrics': asdict(calibration_metrics([calibrator.predict(scores[i]) for i in split.forward_ids],
                    forward_labels, policy['calibrationBins']))}
        forward_scores = [scores[i] for i in split.forward_ids]
        if not all(isfinite(v) for v in forward_scores):
            raise ValueError('ENTRY_BASELINE_NONFINITE_FORWARD_SCORE')
        registry.append({'modelId': model_id, 'model': model, 'calibration': calibrated})
        folds.append({'fold': number, 'state': 'RESEARCH_FORWARD_EVALUATED', 'split': asdict(split),
            'modelId': model_id, 'uncalibratedMetrics': asdict(calibration_metrics(forward_scores, forward_labels, policy['calibrationBins'])),
            'forwardPredictions': [{'observationId': i, 'probability': scores[i]} for i in split.forward_ids],
            'calibration': calibrated})
    payload = {'version': 'theta-entry-baseline-experiment-v1', 'datasetHash': dataset['contentHash'],
        'policy': policy, 'policyHash': hashed(policy), 'generatedAt': generated_at,
        'evidenceClass': dataset['evidenceClass'], 'selectionScope': dataset['selectionScope'],
        'simulationClass': 'CHRONOLOGICAL_RESEARCH_REPLAY', 'plan': asdict(plan), 'folds': folds, 'registry': registry,
        'selectionBiasWarnings': ['SELECTED_ENTRIES_ONLY_NOT_ALL_OPPORTUNITIES',
                                  'RESOLVED_COMPLETE_CASE_BASELINE_NOT_CENSORING_ADJUSTED'],
        'state': 'RESEARCH_FORWARD_EVALUATED' if registry else 'INSUFFICIENT_ELIGIBLE_EVIDENCE',
        'finalOosEvaluated': False, 'effectiveIndependentN': None, 'brokerAuthority': False, 'modelPromoted': False,
        'profitability': 'EMPIRICALLY_UNPROVEN', 'productionEvModel': 'EV_MODEL_NOT_EMPIRICALLY_READY'}
    return {**plain(payload), 'contentHash': hashed(payload)}
