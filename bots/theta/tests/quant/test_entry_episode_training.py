import sys
import unittest
import json
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from test_empirical_pipeline import _build_export, _candidate_raw, _config
from test_whole_chain_dataset import entry_link, outcome
from research.production_export_loader import load_dataset_export
from research.entry_episode_training import build_entry_episode_training_dataset
from research.empirical_pipeline import run_theta_empirical_pipeline


def policy():
    return {'version': 'theta-entry-training-policy-v1', 'policyId': 'DETERMINISTIC_TEST_ONLY',
        'frozenAt': '2025-12-01T00:00:00Z', 'featureNames': ['strike', 'dte', 'bid', 'relativeSpread'],
        'maxQuoteAgeSeconds': 30, 'evidenceClass': 'DETERMINISTIC_TEST'}


def training_fixture(pnl=-20, quoted_at='2026-01-01T14:29:55Z', received_at='2026-01-01T14:29:56Z'):
    c = _candidate_raw()
    c['contract']['dte'] = 16
    c['market'] = {'bid': 1., 'ask': 1.1, 'quoteTimestamp': quoted_at, 'quoteReceivedAt': received_at}
    label = {**outcome(), 'wholeChainNetPnl': pnl, 'labelVersion': 'theta-whole-chain-outcome-resolver-v2',
        'outcomes': {'resolution': 'CLOSED_LEDGER_CHAIN', 'closedAt': '2026-01-01T19:00:00Z'},
        'provenance': {'source': 'THETA_ECONOMIC_LEDGER', 'evidenceAvailableAt': '2026-01-01T20:00:00Z'}}
    quote = {'quoteObservationId': 'quote1', 'candidateId': 'c1', 'managementInputSnapshotId': None,
        'observationRole': 'DECISION', 'observedAt': received_at, 'providerTimestamp': quoted_at,
        'ingestionTimestamp': received_at, 'source': 'ALPACA', 'operationAlias': 'options.snapshots',
        'feed': 'indicative', 'contractVersion': 'test-only', 'bid': 1., 'ask': 1.1,
        'bidSize': 1, 'askSize': 1, 'proposedLimit': None, 'dataQuality': 'GOOD', 'contentHash': 'b' * 64}
    return _build_export(candidates=[c], entryChainLinks=[entry_link()],
                         wholeChainOutcomes=[label], executionEvidence=[quote])


class EntryTrainingTests(unittest.TestCase):
    def test_real_join_path_preserves_loss_and_exact_evidence(self):
        data = load_dataset_export(training_fixture())
        result = build_entry_episode_training_dataset(data, policy())
        row = result['rows'][0]
        self.assertEqual(row['positiveWholeChainLabel'], 0)
        self.assertEqual(row['wholeChainAfterCostPnl'], -20)
        self.assertEqual(row['evidenceIds'], ['c1', 'quote1', 'o1', 'leg1'])
        self.assertEqual(row['labelWindowEnd'], '2026-01-01T19:00:00Z')
        self.assertEqual(result, build_entry_episode_training_dataset(data, policy()))
        self.assertIsNone(result['effectiveIndependentN'])
        self.assertFalse(result['brokerAuthority'])

    def test_break_even_is_not_labeled_a_win(self):
        result = build_entry_episode_training_dataset(load_dataset_export(training_fixture(pnl=0)), policy())
        self.assertEqual(result['rows'][0]['positiveWholeChainLabel'], 0)

    def test_future_and_stale_quote_cannot_train(self):
        for quoted, received in [('2026-01-01T14:30:01Z', '2026-01-01T14:30:02Z'),
                                 ('2026-01-01T14:20:00Z', '2026-01-01T14:20:01Z')]:
            result = build_entry_episode_training_dataset(load_dataset_export(training_fixture(quoted_at=quoted, received_at=received)), policy())
            self.assertEqual(result['rowCount'], 0)
            self.assertIn('PERSISTED_PIT_ENTRY_BBO_REQUIRED', result['excluded'][0]['reasons'])

    def test_new_feature_policy_cannot_retroactively_claim_preregistration(self):
        p = policy(); p['frozenAt'] = '2026-01-02T00:00:00Z'
        result = build_entry_episode_training_dataset(load_dataset_export(training_fixture()), p)
        self.assertIn('FEATURE_POLICY_NOT_PREREGISTERED', result['excluded'][0]['reasons'])

    def test_legacy_label_remains_archived_not_training_qualified(self):
        raw = training_fixture()
        rows = raw['rows']; rows['wholeChainOutcomes'][0]['labelVersion'] = 'legacy-v1'
        result = build_entry_episode_training_dataset(load_dataset_export(_build_export(**rows)), policy())
        self.assertIn('AFTER_COST_LABEL_SEMANTICS_UNQUALIFIED', result['excluded'][0]['reasons'])

    def test_censored_episode_does_not_create_probability_or_negative_label(self):
        raw = training_fixture(); rows = raw['rows']; rows['wholeChainOutcomes'] = []
        result = build_entry_episode_training_dataset(load_dataset_export(_build_export(**rows)), policy())
        self.assertEqual(result['rowCount'], 0)
        self.assertEqual(result['excluded'][0]['reasons'], ['RIGHT_CENSORED_NO_LABEL'])

    def test_unsupported_or_duplicate_feature_is_not_silently_dropped(self):
        for names in (['iv'], ['bid', 'bid'], []):
            with self.assertRaisesRegex(ValueError, 'VOCABULARY'):
                build_entry_episode_training_dataset(load_dataset_export(training_fixture()), {**policy(), 'featureNames': names})

    def test_canonical_pipeline_persists_reloadable_join_without_promoting_readiness(self):
        with tempfile.TemporaryDirectory(prefix='theta-entry-training-test-') as folder:
            result = run_theta_empirical_pipeline(training_fixture(), _config(), entry_training_policy=policy(), output_root=Path(folder))
            artifact = next(Path(p) for p in result.artifacts_written if p.endswith('entry_episode_training_dataset.json'))
            data = json.loads(artifact.read_text())
            self.assertEqual(data['rowCount'], 1)
            self.assertEqual(data['evidenceClass'], 'DETERMINISTIC_TEST')
            self.assertEqual(result.readiness_state.value, 'DESCRIPTIVE_AUDIT_ONLY')
