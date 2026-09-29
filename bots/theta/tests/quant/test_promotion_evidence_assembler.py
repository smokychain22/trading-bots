import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'quant'))
from research.promotion_evidence_assembler import assemble_promotion_evidence


def complete_evidence(**overrides):
    base = {
        'pit': {'splitVersion': 'v1'}, 'baseline': {'modelId': 'm1'}, 'ablation': {'delta': 0.02},
        'oos': {'manifestHash': 'a' * 64}, 'cost': {'costModelVersion': 'v1'}, 'risk': {'aegisState': 'ALLOW_FULL'},
        'calibration': {'brier': 0.2}, 'sampleSize': 500, 'selectionBiasControls': {'dsr': 0.1},
        'reproducibility': {'sourceSha': 'a' * 40},
    }
    base.update(overrides)
    return base


class PromotionEvidenceAssemblerTests(unittest.TestCase):
    def test_complete_evidence_assembles_without_granting_promotion(self):
        result = assemble_promotion_evidence(complete_evidence())
        self.assertEqual(result['state'], 'EVIDENCE_ASSEMBLED_NOT_A_PROMOTION_DECISION')
        self.assertFalse(result['promotionGranted'])
        self.assertEqual(result['missingCategories'], [])

    def test_missing_category_refuses_promotion(self):
        evidence = complete_evidence(); del evidence['oos']
        result = assemble_promotion_evidence(evidence)
        self.assertEqual(result['state'], 'PROMOTION_REFUSED')
        self.assertIn('oos', result['missingCategories'])

    def test_empty_dict_category_counts_as_missing(self):
        result = assemble_promotion_evidence(complete_evidence(risk={}))
        self.assertIn('risk', result['missingCategories'])

    def test_zero_sample_size_is_missing_not_a_falsy_bug(self):
        # sampleSize=0 is a real, meaningful (if useless) value -- but this
        # module treats it as substantively present (not None/empty), since
        # 0 is a real reported number, never silently coerced to "missing".
        result = assemble_promotion_evidence(complete_evidence(sampleSize=0))
        self.assertNotIn('sampleSize', result['missingCategories'])

    def test_multiple_missing_categories_all_named(self):
        evidence = complete_evidence(); del evidence['oos']; del evidence['calibration']
        result = assemble_promotion_evidence(evidence)
        self.assertEqual(set(result['missingCategories']), {'oos', 'calibration'})

    def test_deterministic_hash(self):
        self.assertEqual(assemble_promotion_evidence(complete_evidence()), assemble_promotion_evidence(complete_evidence()))


if __name__ == '__main__':
    unittest.main()
