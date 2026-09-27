import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _candidate_raw
from research.production_export_loader import _load_candidate
from research.q_blocked_d_available_cohort import identify_q_blocked_d_available_cohort


def candidate(cid, branch, hard):
    raw = _candidate_raw(candidate_id=cid, hard=hard)
    raw['decisionId'] = 'd1'
    raw['branch'] = branch
    return _load_candidate(raw)


class QBlockedDAvailableCohortTests(unittest.TestCase):
    def test_q_blocked_and_d_available_forms_cohort_member(self):
        candidates = [
            candidate('q1', 'THETA_CONVENTIONAL', 'DATA_INSUFFICIENT'),
            candidate('d1c', 'THETA_DEFINED_RISK', 'FEASIBLE'),
        ]
        result = identify_q_blocked_d_available_cohort(candidates)
        self.assertEqual(result['memberCount'], 1)
        self.assertEqual(result['members'][0]['qBlockedCandidateIds'], ['q1'])
        self.assertEqual(result['members'][0]['dAvailableCandidateIds'], ['d1c'])
        self.assertFalse(result['members'][0]['dExecutionAuthority'])

    def test_q_feasible_is_not_a_cohort_member(self):
        candidates = [
            candidate('q1', 'THETA_CONVENTIONAL', 'FEASIBLE'),
            candidate('d1c', 'THETA_DEFINED_RISK', 'FEASIBLE'),
        ]
        result = identify_q_blocked_d_available_cohort(candidates)
        self.assertEqual(result['memberCount'], 0)
        self.assertEqual(result['state'], 'NO_COHORT_MEMBERS')

    def test_d_also_blocked_is_not_a_cohort_member(self):
        candidates = [
            candidate('q1', 'THETA_CONVENTIONAL', 'DATA_INSUFFICIENT'),
            candidate('d1c', 'THETA_DEFINED_RISK', 'DATA_INSUFFICIENT'),
        ]
        result = identify_q_blocked_d_available_cohort(candidates)
        self.assertEqual(result['memberCount'], 0)


if __name__ == '__main__':
    unittest.main()
