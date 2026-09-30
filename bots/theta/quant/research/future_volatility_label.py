"""Future volatility LABEL, never an entry-time feature or trading signal.

Uses the existing research sample-log-return RV estimator. The period grid,
annualization, units and IV methodology must be explicit, not inferred from
whatever marks happened to arrive. No provider or broker calls are made.
"""
from datetime import datetime
from math import isfinite
from features.realized_volatility import close_to_close_realized_volatility
from research.production_export_loader import canonical_json, sha256_hex


def _time(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('FUTURE_VOLATILITY_TIMEZONE_REQUIRED')
    return result


def build_future_volatility_label(raw):
    if raw.get('version') != 'theta-future-volatility-input-v1' or raw.get('truthClass') not in ('MARKET_OBSERVED', 'SYNTHETIC_TEST'):
        raise ValueError('FUTURE_VOLATILITY_IDENTITY_REQUIRED')
    for field in ('subjectId', 'underlying', 'policyVersion', 'calendarVersion', 'ivMethod'):
        if not isinstance(raw.get(field), str) or not raw[field].strip():
            raise ValueError('FUTURE_VOLATILITY_PROVENANCE_REQUIRED')
    decision, as_of = _time(raw['decisionAt']), _time(raw['labelAsOf'])
    expected = [_time(t) for t in raw['expectedObservationTimes']]
    if len(expected) < 3 or expected != sorted(set(expected)) or expected[0] != decision:
        raise ValueError('FUTURE_VOLATILITY_EXPECTED_GRID_INVALID')
    if _time(raw['policyFrozenAt']) > decision or raw.get('units') != 'DECIMAL_ANNUALIZED_VOLATILITY':
        raise ValueError('FUTURE_VOLATILITY_POLICY_OR_UNITS_INVALID')
    annualization = raw['periodsPerYear']
    if type(annualization) not in (int, float) or not isfinite(annualization) or annualization <= 0:
        raise ValueError('FUTURE_VOLATILITY_ANNUALIZATION_INVALID')
    iv = raw['ivAtDecision']
    if iv is not None and (type(iv) not in (int, float) or not isfinite(iv) or iv < 0):
        raise ValueError('FUTURE_VOLATILITY_IV_INVALID')
    if iv is not None and (not raw.get('ivEvidenceId') or _time(raw['ivAvailableAt']) > decision):
        raise ValueError('FUTURE_VOLATILITY_IV_PIT_INVALID')
    marks, evidence_ids = {}, set()
    for point in raw['observations']:
        observed, available = _time(point['observedAt']), _time(point['availableAt'])
        if observed not in expected or observed in marks or available < observed or available > as_of:
            raise ValueError('FUTURE_VOLATILITY_OBSERVATION_PIT_OR_GRID_INVALID')
        if point['underlying'] != raw['underlying'] or not point['evidenceId'] or point['evidenceId'] in evidence_ids:
            raise ValueError('FUTURE_VOLATILITY_OBSERVATION_IDENTITY_INVALID')
        price = point['price']
        if type(price) not in (float, int) or not isfinite(price) or price <= 0:
            raise ValueError('FUTURE_VOLATILITY_PRICE_INVALID')
        marks[observed] = price
        evidence_ids.add(point['evidenceId'])
    complete = as_of >= expected[-1] and len(marks) == len(expected) and iv is not None
    rv = close_to_close_realized_volatility([marks[t] for t in expected], annualization, len(expected)-1) if complete else None
    if rv is not None and not isfinite(rv):
        raise ValueError('FUTURE_VOLATILITY_RESULT_NONFINITE')
    variance_difference = None if rv is None else iv * iv - rv * rv
    if variance_difference is not None and not isfinite(variance_difference):
        raise ValueError('FUTURE_VOLATILITY_RESULT_NONFINITE')
    payload = {'version': 'theta-future-volatility-label-v1', 'subjectId': raw['subjectId'],
        'inputHash': sha256_hex(canonical_json(raw)), 'state': 'MATURED_LABEL' if rv is not None else 'INSUFFICIENT_EVIDENCE',
        'role': 'FUTURE_LABEL_ONLY', 'decisionAt': raw['decisionAt'], 'labelAvailableAt': raw['labelAsOf'],
        'truthClass': raw['truthClass'], 'expectedObservationCount': len(expected), 'observedCount': len(marks),
        'estimator': 'RESEARCH_SAMPLE_LOG_RETURN_STANDARD_DEVIATION', 'periodsPerYear': annualization,
        'subsequentRealizedVolatility': rv, 'ivMinusSubsequentRv': None if rv is None else iv-rv,
        'varianceDifference': variance_difference, 'evidenceIds': sorted(evidence_ids),
        'brokerAuthority': False, 'empiricalPromotion': False}
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
