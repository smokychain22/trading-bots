"""Execute the actual risk authority at every numeric boundary. No broker I/O."""
import unittest
from dataclasses import replace
from test_aegis import _clean_inputs, _policy
from test_aegis_contract import _request
from models.aegis import assess_aegis, RiskState
from runtime.aegis_contract import evaluate_request


FIELDS = (
    ("UNDERLYING", "ticker_concentration_pct", "max_ticker_concentration_pct"),
    ("SECTOR", "sector_concentration_pct", "max_sector_concentration_pct"),
    ("CORRELATION", "correlation_cluster_exposure_pct", "max_correlation_cluster_pct"),
    ("PORTFOLIO", "portfolio_capital_at_risk_pct", "max_portfolio_capital_at_risk_pct"),
    ("INVENTORY", "inventory_capacity_used_pct", "max_inventory_capacity_pct"),
    ("ASSIGNMENT", "assignment_capacity_used_pct", "max_assignment_capacity_pct"),
    ("RECOVERY", "recovery_capacity_used_pct", "max_recovery_capacity_pct"),
)


class AegisNumericBoundaryTests(unittest.TestCase):
    def test_each_soft_and_hard_boundary_and_unknown(self):
        policy = _policy()
        for family, field, policy_field in FIELDS:
            soft = getattr(policy, policy_field)
            hard = soft * policy.hard_cap_multiplier
            cases = ((soft - 1e-9, RiskState.ALLOW_FULL), (soft, RiskState.ALLOW_REDUCED),
                     (soft + 1e-9, RiskState.ALLOW_REDUCED), (hard - 1e-9, RiskState.ALLOW_REDUCED),
                     (hard, RiskState.HARD_VETO), (hard + 1e-9, RiskState.HARD_VETO),
                     (None, RiskState.HOLD_ONLY))
            for value, expected in cases:
                with self.subTest(family=family, value=value):
                    result = assess_aegis(policy, replace(_clean_inputs(), **{field: value}))
                    self.assertEqual(next(row.state for row in result.families if row.family.value == family), expected)
                    self.assertEqual(len({row.family for row in result.families}), 12)

    def test_nonfinite_boolean_string_and_negative_exposure_is_invalid_not_clear(self):
        for _, field, policy_field in FIELDS:
            for value in (float("nan"), float("inf"), -float("inf"), -0.01, True, "0.1", {"unit": "percent", "value": 10}):
                with self.subTest(field=field, value=value):
                    with self.assertRaises(ValueError):
                        assess_aegis(_policy(), replace(_clean_inputs(), **{field: value}))
                    with self.assertRaises(ValueError):
                        assess_aegis(replace(_policy(), **{policy_field: value}), _clean_inputs())

    def test_boolean_inputs_reject_truthy_and_falsy_coercion(self):
        for field in ("liquidity_acceptable", "execution_quality_acceptable", "stress_gap_detected",
                      "stress_iv_shock_detected", "stress_spread_widening_detected"):
            for value in (0, 1, "false", "true", "", [], {}):
                with self.subTest(field=field, value=value):
                    with self.assertRaises(ValueError):
                        assess_aegis(_policy(), replace(_clean_inputs(), **{field: value}))

    def test_real_runtime_boundary_cannot_emit_allow_for_nan_or_string_false(self):
        for field, value in (("tickerConcentrationPct", float("nan")), ("liquidityAcceptable", "false"),
                             ("executionQualityAcceptable", 0), ("stressIvShockDetected", "false")):
            request = _request()
            request["inputs"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                evaluate_request(request)

    def test_zero_risk_budget_is_valid_restrictive_policy_not_raised_to_positive(self):
        result = assess_aegis(_policy(max_ticker_concentration_pct=0), _clean_inputs(ticker_concentration_pct=0))
        self.assertEqual(result.new_risk_state, RiskState.HARD_VETO)

    def test_overflowing_hard_threshold_is_not_an_unreachable_veto(self):
        with self.assertRaises(ValueError):
            assess_aegis(_policy(max_ticker_concentration_pct=1e308, hard_cap_multiplier=10), _clean_inputs())

    def test_twelve_family_receipts_preserve_exact_consumed_inputs_and_unknown_source_times(self):
        request = _request()
        response = evaluate_request(request)
        for family in response['families']:
            trace = family['inputEvidence']
            self.assertEqual(trace['decisionId'], request['decisionId'])
            self.assertEqual(trace['snapshotId'], request['snapshotId'])
            self.assertEqual(trace['decisionAsOf'], request['timestamp'])
            self.assertIsNone(trace['sourceObservedAt'])
            self.assertIsNone(trace['quantityCapacity'])
            for name, value in trace['inputs'].items():
                self.assertEqual(value, request['inputs'].get(name, 'REQUIRED'))
        underlying = next(row for row in response['families'] if row['family'] == 'UNDERLYING')['inputEvidence']
        self.assertEqual(underlying['softThreshold'], request['policy']['maxTickerConcentrationPct'])
        self.assertEqual(underlying['hardThreshold'], request['policy']['maxTickerConcentrationPct'] * request['policy']['hardCapMultiplier'])


if __name__ == '__main__':
    unittest.main()
