import sys
import unittest
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "quant"))

from research.severe_drawdown_model_contract import (
    ChronologicalFold, SevereDrawdownArtifactRegistry, SevereDrawdownTrainingPlan,
    build_artifact, infer_severe_drawdown, validate_chronological_folds, validate_training_plan,
)


def artifact(state="MODEL_PAPER_RISK_ELIGIBLE"):
    return build_artifact(
        model_version="risk-v1", label_spec_version="label-v1", dataset_version="dataset-v1",
        feature_version="feature-v1", train_range=("2020-01-01", "2022-12-31"),
        validation_ranges=(("2023-01-01", "2023-12-31"),), oos_range=("2024-01-01", "2024-12-31"),
        model_family="REGULARIZED_LOGISTIC", required_features=("rv20",), coefficients={"rv20": 2.0},
        intercept=-1.0, calibration={"validated": True}, metrics={"brier": 0.2}, promotion_state=state,
        created_at="2025-01-01T00:00:00Z",
    )


class SevereDrawdownModelContractTests(unittest.TestCase):
    def test_nonfinite_feature_missing_coefficient_and_string_false_cannot_infer(self):
        model = artifact()
        for features, selected in (({'rv20': float('nan')}, model), ({'rv20': .2}, replace(model, coefficients={})),
                ({'rv20': .2}, replace(model, calibration={'validated': 'false'}))):
            value = infer_severe_drawdown(selected, features, 'feature-v1', '2025-01-01')
            self.assertEqual(value.state, 'UNKNOWN')
            self.assertIsNone(value.probability)

    def test_inference_is_unknown_without_promoted_valid_artifact_and_features(self):
        self.assertEqual(infer_severe_drawdown(None, {"rv20": 0.2}, "feature-v1", "2025-01-01").state, "UNKNOWN")
        self.assertEqual(infer_severe_drawdown(artifact("RESEARCH_ONLY"), {"rv20": 0.2}, "feature-v1", "2025-01-01").state, "UNKNOWN")
        self.assertEqual(infer_severe_drawdown(artifact(), {"rv20": None}, "feature-v1", "2025-01-01").missing_feature_reasons, ("MISSING_FEATURE:rv20",))
        self.assertEqual(infer_severe_drawdown(artifact(), {"rv20": 0.2}, "wrong", "2025-01-01").state, "UNKNOWN")

    def test_promoted_calibrated_logistic_artifact_can_infer_and_hash_is_deterministic(self):
        first = artifact()
        self.assertEqual(first.artifact_hash, artifact().artifact_hash)
        result = infer_severe_drawdown(first, {"rv20": 0.2}, "feature-v1", "2025-01-01")
        self.assertEqual(result.state, "KNOWN")
        self.assertAlmostEqual(result.probability, 0.3543436938)

    def test_chronological_fold_validation_rejects_leakage_and_accepts_purged_fold(self):
        validate_chronological_folds([ChronologicalFold("2020-01-01", "2022-12-31", "2023-01-10", "2023-12-31", 5, 5)])
        with self.assertRaisesRegex(ValueError, "not chronological"):
            validate_chronological_folds([ChronologicalFold("2023-01-01", "2023-12-31", "2023-06-01", "2024-01-01", 0, 0)])

    def test_training_plan_cannot_request_promotion_and_registry_is_hash_checked(self):
        fold = ChronologicalFold("2020-01-01", "2022-12-31", "2023-01-10", "2023-12-31", 5, 5)
        plan = SevereDrawdownTrainingPlan("plan-v1", "label-v1", "dataset-v1", "feature-v1",
            ("REGULARIZED_LOGISTIC",), (fold,), ("BRIER", "LOG_LOSS"), True)
        validate_training_plan(plan)
        with self.assertRaisesRegex(ValueError, "cannot request promotion"):
            validate_training_plan(SevereDrawdownTrainingPlan(**{**plan.__dict__, "promotion_requested": True}))
        registry = SevereDrawdownArtifactRegistry()
        registry.register(artifact())
        self.assertEqual(registry.paper_risk_eligible()[0].model_version, "risk-v1")
        changed = artifact()
        object.__setattr__(changed, "artifact_hash", "0" * 64)
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            registry.register(changed)


if __name__ == "__main__":
    unittest.main()
