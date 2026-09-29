import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.management_accounting_fixtures import LegRealization, basis_after_assignment, whole_chain_realized_pnl


def leg(leg_id, event_kind, pnl, fees=1.0, capital_days=5.0, opened='2026-01-01T00:00:00Z', closed='2026-01-06T00:00:00Z'):
    return LegRealization(leg_id, event_kind, pnl, fees, capital_days, opened, closed)


class ManagementAccountingFixturesTests(unittest.TestCase):
    def test_roll_old_leg_realized_loss_persists_into_whole_chain_total(self):
        # Old CSP closed for a realized LOSS, then a new CSP opened and later
        # closed for a PROFIT. The roll must never erase the old loss.
        legs = [
            leg('old', 'ROLL_CLOSE', pnl=-50.0),
            leg('new', 'ROLL_OPEN', pnl=None, closed=None),  # not yet resolved
            leg('new_close', 'BTC_CLOSE', pnl=30.0),
        ]
        result = whole_chain_realized_pnl(legs)
        self.assertEqual(result['wholeChainRealizedPnl'], -50.0 + 30.0)
        self.assertEqual(result['state'], 'PARTIALLY_RESOLVED')  # the ROLL_OPEN leg itself never resolved

    def test_fees_counted_once_per_leg_never_doubled(self):
        legs = [leg('a', 'CSP_OPEN', pnl=None, fees=1.0, closed=None), leg('b', 'EXPIRE_OTM', pnl=100.0, fees=1.0)]
        result = whole_chain_realized_pnl(legs)
        self.assertEqual(result['totalFeesPaid'], 2.0)  # one fee per leg, not per event mentioned

    def test_duplicate_leg_id_rejected(self):
        legs = [leg('a', 'CSP_OPEN', pnl=1.0), leg('a', 'BTC_CLOSE', pnl=2.0)]
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_LEG_ID'):
            whole_chain_realized_pnl(legs)

    def test_no_legs_rejected(self):
        with self.assertRaisesRegex(ValueError, 'NO_LEGS'):
            whole_chain_realized_pnl([])

    def test_capital_days_sum_across_full_lifecycle(self):
        legs = [
            leg('csp', 'CSP_OPEN', pnl=None, capital_days=10.0, closed=None),
            leg('assign', 'ASSIGNMENT', pnl=-20.0, capital_days=0.0),
            leg('hold', 'HOLD', pnl=None, capital_days=15.0, closed=None),
            leg('cc', 'CC_OPEN', pnl=10.0, capital_days=5.0),
            leg('callaway', 'CALL_AWAY', pnl=30.0, capital_days=0.0),
        ]
        result = whole_chain_realized_pnl(legs)
        self.assertEqual(result['totalCapitalDays'], 30.0)
        self.assertEqual(result['wholeChainRealizedPnl'], -20.0 + 10.0 + 30.0)

    def test_basis_after_assignment_uses_strike_not_premium(self):
        self.assertEqual(basis_after_assignment(strike=100.0, fees_paid_on_assignment=1.0), 101.0)

    def test_non_positive_strike_rejected(self):
        with self.assertRaisesRegex(ValueError, 'STRIKE_MUST_BE_POSITIVE'):
            basis_after_assignment(strike=0.0, fees_paid_on_assignment=1.0)


if __name__ == '__main__':
    unittest.main()
