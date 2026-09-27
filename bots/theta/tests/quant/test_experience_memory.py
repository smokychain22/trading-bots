import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.experience_memory import ExperienceMemory, ExperienceRecord


def record(episode_id='e1', **overrides):
    base = dict(episode_id=episode_id, strategy='THETA_CONVENTIONAL', regime='BULL_LOW_VOL',
        dte_bucket='8_21', delta_bucket='0.20_0.25', iv_bucket=None, skew_bucket=None,
        flow_bucket=None, management_action=None, drawdown_bucket=None, recovery_state=None,
        reason_codes=('ECONOMIC_VALUE_INSUFFICIENT',), evidence_ref='ref-1')
    base.update(overrides)
    return ExperienceRecord(**base)


class ExperienceMemoryTests(unittest.TestCase):
    def test_query_by_single_field(self):
        memory = ExperienceMemory()
        memory.add(record('e1', strategy='THETA_CONVENTIONAL'))
        memory.add(record('e2', strategy='THETA_HOLD_STRIKE'))
        results = memory.query(strategy='THETA_CONVENTIONAL')
        self.assertEqual([r.episode_id for r in results], ['e1'])

    def test_query_by_reason_code(self):
        memory = ExperienceMemory()
        memory.add(record('e1', reason_codes=('A', 'B')))
        memory.add(record('e2', reason_codes=('C',)))
        results = memory.query(reason_code='B')
        self.assertEqual([r.episode_id for r in results], ['e1'])

    def test_query_combines_filters(self):
        memory = ExperienceMemory()
        memory.add(record('e1', regime='BULL_LOW_VOL', dte_bucket='8_21'))
        memory.add(record('e2', regime='BULL_LOW_VOL', dte_bucket='22_45'))
        results = memory.query(regime='BULL_LOW_VOL', dte_bucket='8_21')
        self.assertEqual([r.episode_id for r in results], ['e1'])

    def test_never_ranks_returns_all_matches_deterministically_ordered(self):
        memory = ExperienceMemory()
        memory.add(record('e2'))
        memory.add(record('e1'))
        results = memory.query(strategy='THETA_CONVENTIONAL')
        self.assertEqual([r.episode_id for r in results], ['e1', 'e2'])

    def test_unknown_filter_field_rejected(self):
        memory = ExperienceMemory()
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_FILTER_FIELD'):
            memory.query(not_a_real_field='x')

    def test_conflicting_episode_id_rejected(self):
        memory = ExperienceMemory()
        memory.add(record('e1', strategy='THETA_CONVENTIONAL'))
        with self.assertRaisesRegex(ValueError, 'EPISODE_ID_CONFLICT'):
            memory.add(record('e1', strategy='THETA_HOLD_STRIKE'))

    def test_readding_identical_record_is_a_noop(self):
        memory = ExperienceMemory()
        memory.add(record('e1'))
        memory.add(record('e1'))
        self.assertEqual(len(memory), 1)


if __name__ == '__main__':
    unittest.main()
