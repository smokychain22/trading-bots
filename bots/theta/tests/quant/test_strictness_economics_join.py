import sys
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.strictness_economics_join import join_strictness_to_outcomes


@dataclass(frozen=True)
class Row:
    strategy: str
    date: str
    reason_code: str
    candidate_id: Optional[str]


def always_valid(row, outcome):
    return True


class StrictnessEconomicsJoinTests(unittest.TestCase):
    def test_missing_candidate_identity(self):
        result = join_strictness_to_outcomes([Row('THETA_CONVENTIONAL', '2026-01-01', 'ECONOMIC_VALUE_INSUFFICIENT', None)], {}, always_valid)
        self.assertEqual(result['unjoined'][0]['state'], 'CANDIDATE_IDENTITY_MISSING')

    def test_no_outcome_available(self):
        rows = [Row('THETA_CONVENTIONAL', '2026-01-01', 'ECONOMIC_VALUE_INSUFFICIENT', 'c1')]
        result = join_strictness_to_outcomes(rows, {}, always_valid)
        self.assertEqual(result['unjoined'][0]['state'], 'NO_OUTCOME_AVAILABLE')

    def test_horizon_invalid_blocks_join(self):
        rows = [Row('THETA_CONVENTIONAL', '2026-01-01', 'ECONOMIC_VALUE_INSUFFICIENT', 'c1')]
        result = join_strictness_to_outcomes(rows, {'c1': {'pnl': -5}}, lambda r, o: False)
        self.assertEqual(result['unjoined'][0]['state'], 'HORIZON_INVALID')
        self.assertEqual(result['joinedCount'], 0)

    def test_valid_join_never_claims_causality_or_execution(self):
        rows = [Row('THETA_CONVENTIONAL', '2026-01-01', 'ECONOMIC_VALUE_INSUFFICIENT', 'c1')]
        result = join_strictness_to_outcomes(rows, {'c1': {'pnl': -5}}, always_valid)
        joined = result['joined'][0]
        self.assertFalse(joined['executionAuthority'])
        self.assertIn('NOT_A_COUNTERFACTUAL_ESTIMATE', joined['causalClaim'])
        self.assertEqual(joined['outcome'], {'pnl': -5})

    def test_no_eligible_joins_state(self):
        result = join_strictness_to_outcomes([], {}, always_valid)
        self.assertEqual(result['state'], 'NO_ELIGIBLE_JOINS')


if __name__ == '__main__':
    unittest.main()
