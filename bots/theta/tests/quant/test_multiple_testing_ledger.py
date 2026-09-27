import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.multiple_testing_ledger import build_multiple_testing_ledger, trial_identities_for_selection_bias


class MultipleTestingLedgerTests(unittest.TestCase):
    def test_subject_is_first_identity(self):
        ledger = build_multiple_testing_ledger(['ABLATE-FLOW', 'ABLATE-CONTRACT', 'ABLATE-EVENT'], 'ABLATE-EVENT')
        self.assertEqual(ledger['trialIdentities'][0], 'ABLATE-EVENT')
        self.assertEqual(ledger['trialCount'], 3)

    def test_unregistered_id_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNREGISTERED_TRIAL_ID'):
            build_multiple_testing_ledger(['ABLATE-FLOW', 'NOT_A_REAL_EXPERIMENT_ID'], 'ABLATE-FLOW')

    def test_subject_must_be_in_considered_set(self):
        with self.assertRaisesRegex(ValueError, 'SUBJECT_MUST_BE_IN_CONSIDERED_SET'):
            build_multiple_testing_ledger(['ABLATE-FLOW', 'ABLATE-CONTRACT'], 'ABLATE-EVENT')

    def test_duplicate_id_rejected(self):
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_TRIAL_ID'):
            build_multiple_testing_ledger(['ABLATE-FLOW', 'ABLATE-FLOW'], 'ABLATE-FLOW')

    def test_empty_trial_set_rejected(self):
        with self.assertRaisesRegex(ValueError, 'EMPTY_TRIAL_SET'):
            build_multiple_testing_ledger([], 'ABLATE-FLOW')

    def test_trial_identities_for_selection_bias_roundtrip(self):
        ledger = build_multiple_testing_ledger(['ABLATE-FLOW', 'ABLATE-CONTRACT'], 'ABLATE-FLOW')
        self.assertEqual(trial_identities_for_selection_bias(ledger), ('ABLATE-FLOW', 'ABLATE-CONTRACT'))

    def test_deterministic_hash(self):
        first = build_multiple_testing_ledger(['ABLATE-FLOW', 'ABLATE-CONTRACT'], 'ABLATE-FLOW')
        second = build_multiple_testing_ledger(['ABLATE-FLOW', 'ABLATE-CONTRACT'], 'ABLATE-FLOW')
        self.assertEqual(first, second)


if __name__ == '__main__':
    unittest.main()
