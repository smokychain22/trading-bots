import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.management_checkpoint_outcomes import build_management_checkpoint_outcome


def management_row(**overrides):
    base = {
        'observationId': 'm1', 'economicChainId': 'chain1', 'fusionSnapshotId': 'f1',
        'observedAt': '2026-01-01T15:00:00Z', 'lifecycleState': 'CSP_OPEN', 'inputFields': {},
        'unknownFields': [], 'feasibleActions': [], 'selectedAction': 'HOLD', 'secondBestAction': None,
        'decisionState': 'DECIDED', 'reasonCodes': [], 'contentHash': 'a' * 64,
        'futureOutcome': {'state': 'RESOLVED_EXPORTED_LABEL', 'wholeChainAfterCostPnl': -20},
    }
    base.update(overrides)
    return base


class ManagementCheckpointOutcomesTests(unittest.TestCase):
    def test_four_way_separation(self):
        lifecycle = [{'eventKind': 'BTC_CLOSE', 'appliedAt': '2026-01-05T00:00:00Z'}]
        result = build_management_checkpoint_outcome(management_row(), lifecycle)
        self.assertEqual(result.t0_state['selectedAction'], 'HOLD')
        self.assertNotIn('futureOutcome', result.t0_state)
        self.assertEqual(result.whole_chain_outcome['wholeChainAfterCostPnl'], -20)
        self.assertEqual(result.later_broker_lifecycle[0]['eventKind'], 'BTC_CLOSE')
        self.assertEqual(result.later_market_observation, {'state': 'NOT_CAPTURED_NO_HORIZON_DATA'})

    def test_market_observation_passthrough_when_provided(self):
        market_obs = {'truthClass': 'MARKET_OBSERVED', 'bid': 1.0}
        result = build_management_checkpoint_outcome(management_row(), [], later_market_observation=market_obs)
        self.assertEqual(result.later_market_observation, market_obs)

    def test_missing_required_field_rejected(self):
        row = management_row()
        del row['futureOutcome']
        with self.assertRaisesRegex(ValueError, 'FIELD_MISSING:futureOutcome'):
            build_management_checkpoint_outcome(row, [])

    def test_deterministic_hash(self):
        first = build_management_checkpoint_outcome(management_row(), [])
        second = build_management_checkpoint_outcome(management_row(), [])
        self.assertEqual(first.content_hash, second.content_hash)


if __name__ == '__main__':
    unittest.main()
