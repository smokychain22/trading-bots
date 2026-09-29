import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.future_capture_contract import (
    FUTURE_CAPTURE_REGISTRY, FUTURE_CAPTURE_REGISTRY_BY_ID, build_codex_handoff,
)


class FutureCaptureContractTests(unittest.TestCase):
    def test_registry_covers_required_families(self):
        required_prefixes = ('filled', 'fill_price', 'assignment_event', 'exercise_event', 'expiration_outcome',
                              'future_bbo', 'future_underlying_price', 'future_iv', 'future_greeks',
                              'management_action_taken', 'management_outcome', 'whole_chain_state')
        for field_id in required_prefixes:
            self.assertIn(field_id, FUTURE_CAPTURE_REGISTRY_BY_ID)

    def test_every_spec_has_never_zero_missing_behavior(self):
        for spec in FUTURE_CAPTURE_REGISTRY:
            self.assertEqual(spec.missing_behavior, 'UNKNOWN_NEVER_ZERO_OR_FABRICATED')

    def test_no_duplicate_field_ids(self):
        ids = [s.field_id for s in FUTURE_CAPTURE_REGISTRY]
        self.assertEqual(len(ids), len(set(ids)))

    def test_handoff_generated_for_required_field(self):
        handoff = build_codex_handoff('assignment_event', claude_sha='a' * 40)
        self.assertEqual(handoff['handoffId'], 'HANDOFF-FUTURE-CAPTURE-ASSIGNMENT_EVENT')
        self.assertIn('contentHash', handoff)

    def test_handoff_rejected_for_optional_field(self):
        with self.assertRaisesRegex(ValueError, 'ONLY_FOR_REQUIRED_FIELDS'):
            build_codex_handoff('fill_latency_seconds', claude_sha='a' * 40)

    def test_handoff_rejected_for_unknown_field(self):
        with self.assertRaisesRegex(ValueError, 'UNKNOWN_FIELD_ID'):
            build_codex_handoff('not_a_real_field', claude_sha='a' * 40)

    def test_deterministic_handoff_hash(self):
        first = build_codex_handoff('filled', claude_sha='a' * 40)
        second = build_codex_handoff('filled', claude_sha='a' * 40)
        self.assertEqual(first, second)


if __name__ == '__main__':
    unittest.main()
