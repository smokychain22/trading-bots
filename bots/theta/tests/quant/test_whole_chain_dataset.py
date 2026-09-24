import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _build_export
from research.production_export_loader import load_dataset_export
from research.whole_chain_dataset import build_whole_chain_dataset


def outcome(identity='o1', subject='chain1'):
    return {'outcomeLabelId': identity, 'subjectType': 'WHOLE_CHAIN', 'subjectId': subject,
        'labelAvailableAt': '2026-01-01T20:00:00Z', 'labelVersion': 'test-v1', 'censoringState': 'RESOLVED',
        'wholeChainNetPnl': -20., 'provenance': {}, 'contentHash': 'a' * 64}


class WholeChainDatasetTests(unittest.TestCase):
    def test_candidate_scans_are_not_fabricated_episodes(self):
        result = build_whole_chain_dataset(load_dataset_export(_build_export()))
        self.assertEqual(result['rowCount'], 0)
        self.assertEqual(result['candidateRowsNotInferredAsEpisodes'], 1)

    def test_real_explicit_chain_label_is_preserved_without_invented_entry(self):
        result = build_whole_chain_dataset(load_dataset_export(_build_export(wholeChainOutcomes=[outcome()])))
        row = result['rows'][0]
        self.assertEqual(row['wholeChainAfterCostPnl'], -20)
        self.assertIsNone(row['entryCandidateIds'])
        self.assertEqual(row['trainingEligibility'], 'NOT_ASSESSED')
        self.assertEqual(result, build_whole_chain_dataset(load_dataset_export(_build_export(wholeChainOutcomes=[outcome()]))))

    def test_revisions_are_visible_not_arbitrarily_selected(self):
        result = build_whole_chain_dataset(load_dataset_export(_build_export(wholeChainOutcomes=[outcome(), outcome('o2')])))
        row = result['rows'][0]
        self.assertEqual(row['outcomeState'], 'LABEL_REVISION_REQUIRES_EXPLICIT_SELECTION')
        self.assertIsNone(row['wholeChainAfterCostPnl'])

    def test_future_label_cannot_join_earlier_export(self):
        row = outcome(); row['labelAvailableAt'] = '2026-01-03T20:00:00Z'
        with self.assertRaisesRegex(ValueError, 'AFTER_EXPORT'):
            build_whole_chain_dataset(load_dataset_export(_build_export(wholeChainOutcomes=[row])))
