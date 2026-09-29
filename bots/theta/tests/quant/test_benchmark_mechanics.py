import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.benchmark_mechanics import (
    buy_and_hold_return, closest_delta_selection, covered_call_max_yield_selection, fixed_capture_exit, fixed_time_exit,
    hold_to_expiry_outcome, immediate_cc_after_assignment, mechanical_assignment_response,
    random_eligible_selection, select_by_metric, unconditional_hold_to_basis_recovery,
)


def candidate(cid, hard='FEASIBLE', **fields):
    return {'candidateId': cid, 'hardStatus': hard, **fields}


class SelectByMetricTests(unittest.TestCase):
    def test_picks_max_metric_among_feasible(self):
        cands = [candidate('c1', bid=1.0), candidate('c2', bid=2.0), candidate('c3', hard='REJECTED', bid=5.0)]
        result = select_by_metric(cands, 'bid', higher_is_better=True)
        self.assertEqual(result['candidateId'], 'c2')

    def test_missing_metric_raises_named_error(self):
        cands = [candidate('c1', bid=1.0), candidate('c2')]
        with self.assertRaisesRegex(ValueError, 'METRIC_MISSING:bid:c2'):
            select_by_metric(cands, 'bid')

    def test_no_eligible_candidates_returns_none(self):
        self.assertIsNone(select_by_metric([candidate('c1', hard='REJECTED', bid=1.0)], 'bid'))


class RandomEligibleSelectionTests(unittest.TestCase):
    def test_deterministic_for_same_seed(self):
        cands = [candidate('c1'), candidate('c2'), candidate('c3')]
        self.assertEqual(random_eligible_selection(cands, 42), random_eligible_selection(cands, 42))

    def test_excludes_ineligible(self):
        cands = [candidate('c1', hard='REJECTED')]
        self.assertIsNone(random_eligible_selection(cands, 1))


class ClosestDeltaSelectionTests(unittest.TestCase):
    def test_selects_nearest_absolute_delta_deterministically(self):
        cands = [candidate('c2', delta=-0.22), candidate('c1', delta=-0.18), candidate('c3', delta=-0.4)]
        self.assertEqual(closest_delta_selection(cands, 0.20)['candidateId'], 'c1')

    def test_missing_delta_is_not_silently_skipped(self):
        with self.assertRaisesRegex(ValueError, 'DELTA_MISSING:c1'):
            closest_delta_selection([candidate('c1')], 0.20)


class FixedCaptureExitTests(unittest.TestCase):
    def test_finds_first_point_reaching_capture_fraction(self):
        path = [('t1', 0.9), ('t2', 0.5), ('t3', 0.1)]
        result = fixed_capture_exit(entry_credit=1.0, price_path=path, capture_fraction=0.5)
        self.assertEqual(result['exitTimestamp'], 't2')
        self.assertAlmostEqual(result['realizedPnl'], 0.5)

    def test_never_reaches_capture_returns_none(self):
        path = [('t1', 0.9), ('t2', 0.8)]
        self.assertIsNone(fixed_capture_exit(1.0, path, 0.5))

    def test_invalid_capture_fraction_rejected(self):
        with self.assertRaisesRegex(ValueError, 'CAPTURE_FRACTION_INVALID'):
            fixed_capture_exit(1.0, [], 1.5)


class FixedTimeExitTests(unittest.TestCase):
    def test_exits_at_fixed_bar(self):
        path = [('t1', 0.9), ('t2', 0.5), ('t3', 0.1)]
        result = fixed_time_exit(path, entry_credit=1.0, hold_bars=2)
        self.assertEqual(result['exitTimestamp'], 't2')

    def test_path_shorter_than_hold_bars_returns_none(self):
        self.assertIsNone(fixed_time_exit([('t1', 0.9)], 1.0, hold_bars=5))


class HoldToExpiryOutcomeTests(unittest.TestCase):
    def test_never_infers_assignment(self):
        result = hold_to_expiry_outcome(entry_credit=1.0, underlying_price_at_expiration=90.0, strike=100.0)
        self.assertEqual(result['assignmentDetermination'], 'NOT_INFERRED_FROM_MONEYNESS_SEE_ASSIGNMENT_LABELS_MODULE')
        self.assertTrue(result['itmAtExpiration'])
        self.assertAlmostEqual(result['realizedOptionPnl'], 1.0 - 10.0)


class MechanicalAssignmentResponseTests(unittest.TestCase):
    def test_ba1_always_closes_before_assignment(self):
        self.assertEqual(mechanical_assignment_response(True, 'BA1_CLOSE_BEFORE_ASSIGNMENT'), 'CLOSED_BEFORE_ASSIGNMENT_EVENT')

    def test_ba3_accepts_only_when_actually_assigned(self):
        self.assertEqual(mechanical_assignment_response(True, 'BA3_UNCONDITIONAL_ACCEPT'), 'ACCEPTED')
        self.assertEqual(mechanical_assignment_response(False, 'BA3_UNCONDITIONAL_ACCEPT'), 'NOT_APPLICABLE_NOT_ASSIGNED')

    def test_unknown_policy_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_ASSIGNMENT_POLICY'):
            mechanical_assignment_response(True, 'NOT_A_REAL_POLICY')


class UnconditionalHoldToBasisRecoveryTests(unittest.TestCase):
    def test_recovered_when_price_at_or_above_basis(self):
        self.assertTrue(unconditional_hold_to_basis_recovery(100.0, 100.0)['recovered'])
        self.assertFalse(unconditional_hold_to_basis_recovery(100.0, 90.0)['recovered'])


class CoveredCallMaxYieldSelectionTests(unittest.TestCase):
    def test_picks_max_yield(self):
        cands = [candidate('c1', annualizedYield=0.1), candidate('c2', annualizedYield=0.3)]
        self.assertEqual(covered_call_max_yield_selection(cands)['candidateId'], 'c2')

    def test_missing_yield_raises(self):
        with self.assertRaisesRegex(ValueError, 'ANNUALIZED_YIELD_MISSING'):
            covered_call_max_yield_selection([candidate('c1')])


class ImmediateCcAfterAssignmentTests(unittest.TestCase):
    def test_sells_only_when_assigned(self):
        self.assertEqual(immediate_cc_after_assignment(True), 'SELL_CC_IMMEDIATELY')
        self.assertEqual(immediate_cc_after_assignment(False), 'NOT_APPLICABLE_NOT_ASSIGNED')


class BuyAndHoldReturnTests(unittest.TestCase):
    def test_real_return(self):
        self.assertAlmostEqual(buy_and_hold_return(100.0, 110.0), 0.1)

    def test_non_positive_entry_price_rejected(self):
        with self.assertRaisesRegex(ValueError, 'ENTRY_PRICE_MUST_BE_POSITIVE'):
            buy_and_hold_return(0.0, 100.0)


if __name__ == '__main__':
    unittest.main()
