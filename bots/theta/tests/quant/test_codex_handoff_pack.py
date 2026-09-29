import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.codex_handoff_pack import build_codex_handoff_pack


def fields(**overrides):
    base = dict(
        handoff_id='HANDOFF-EXAMPLE-1', claude_sha='a' * 40, source_schema_or_api='research.example.ExampleSpec',
        target_schema_or_api='Codex runtime persistence for example', exported_symbol='research.example.ExampleSpec',
        codex_target_layer='bots/theta/app/execution/', input_description='an example input',
        output_description='an example output', persistence='ARCHIVE', error_behavior='missing -> UNKNOWN',
        acceptance_test='a decision before as_of never reads this field',
    )
    base.update(overrides)
    return base


class CodexHandoffPackTests(unittest.TestCase):
    def test_builds_complete_handoff(self):
        handoff = build_codex_handoff_pack(**fields())
        self.assertEqual(handoff.handoff_id, 'HANDOFF-EXAMPLE-1')
        self.assertTrue(handoff.content_hash)

    def test_missing_field_rejected(self):
        values = fields(); del values['acceptance_test']
        with self.assertRaisesRegex(ValueError, 'FIELD_REQUIRED:acceptance_test'):
            build_codex_handoff_pack(**values)

    def test_unexpected_field_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNEXPECTED_FIELD'):
            build_codex_handoff_pack(**fields(), not_a_real_field='x')

    def test_target_layer_must_be_codex_owned(self):
        with self.assertRaisesRegex(ValueError, 'MUST_BE_CODEX_OWNED'):
            build_codex_handoff_pack(**fields(codex_target_layer='bots/theta/quant/research/'))

    def test_src_target_layer_accepted(self):
        handoff = build_codex_handoff_pack(**fields(codex_target_layer='src/theta/point-in-time-evidence.ts'))
        self.assertEqual(handoff.codex_target_layer, 'src/theta/point-in-time-evidence.ts')

    def test_deterministic_hash(self):
        self.assertEqual(build_codex_handoff_pack(**fields()), build_codex_handoff_pack(**fields()))


if __name__ == '__main__':
    unittest.main()
