import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _build_export
from research.production_export_loader import load_dataset_export, DatasetLoadError
from research.whole_chain_dataset import build_whole_chain_dataset


def entry_link():
    return {'optionLegId': 'leg1', 'chainId': 'chain1', 'optionContractId': 'contract1',
        'contractSymbol': 'AAPL260117P00150000',
        'decisionId': 'd1', 'candidateId': 'c1', 'branch': 'THETA_CONVENTIONAL',
        'decisionAt': '2026-01-01T14:30:00Z', 'legOpenedAt': '2026-01-01T14:31:00Z',
        'chainOpenedAt': '2026-01-01T14:30:00Z', 'linkObservedAt': '2026-01-01T14:31:01Z',
        'authority': 'THETA_PERSISTED_DECISION', 'linkVersion': 'EXPLICIT_CSP_ENTRY_LEDGER_JOIN_V1'}


def outcome(identity='o1', subject='chain1'):
    return {'outcomeLabelId': identity, 'subjectType': 'WHOLE_CHAIN', 'subjectId': subject,
        'labelAvailableAt': '2026-01-01T20:00:00Z', 'labelVersion': 'test-v1', 'censoringState': 'RESOLVED',
        'wholeChainNetPnl': -20., 'provenance': {}, 'contentHash': 'a' * 64}


class WholeChainDatasetTests(unittest.TestCase):
    def test_explicit_ledger_entry_is_joined_and_not_confused_with_label_time(self):
        raw = _build_export(wholeChainOutcomes=[outcome()], entryChainLinks=[entry_link()])
        result = build_whole_chain_dataset(load_dataset_export(raw))
        row = result['rows'][0]
        self.assertEqual(row['entryCandidateIds'], ['c1'])
        self.assertEqual(row['entryLinkageState'], 'EXPLICIT_LEDGER_JOIN')
        self.assertEqual(row['entryJoinAvailableAt'], '2026-01-01T14:31:01Z')
        self.assertEqual(row['labelAvailableAt'], '2026-01-01T20:00:00Z')
        self.assertEqual(row['wholeChainAfterCostPnl'], -20)
        self.assertEqual(row['trainingEligibility'], 'NOT_ASSESSED')

    def test_unresolved_entry_stays_censored_and_is_not_a_win(self):
        result = build_whole_chain_dataset(load_dataset_export(_build_export(entryChainLinks=[entry_link()])))
        self.assertEqual(result['rowCount'], 1)
        self.assertEqual(result['rows'][0]['outcomeState'], 'RIGHT_CENSORED_NO_LABEL')
        self.assertIsNone(result['rows'][0]['wholeChainAfterCostPnl'])

    def test_bad_join_lineage_and_future_observation_are_rejected(self):
        for patch in ({'candidateId': 'wrong'}, {'decisionId': 'wrong'}, {'branch': 'THETA_CC'},
                      {'authority': 'OPTIONOMICS_SESSION_RESEARCH'}, {'decisionAt': '2026-01-01T14:29:00Z'},
                      {'linkObservedAt': '2026-01-03T14:31:01Z'}, {'legOpenedAt': '2026-01-01T14:29:00Z'}):
            with self.assertRaises(DatasetLoadError):
                load_dataset_export(_build_export(entryChainLinks=[{**entry_link(), **patch}]))

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
