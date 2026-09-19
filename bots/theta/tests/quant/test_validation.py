from math import isclose

from research.validation import (
    ValidationObservation,
    WalkForwardConfig,
    build_grouped_walk_forward_plan,
    calibration_metrics,
    fit_isotonic_calibrator,
    fit_platt_scaler,
)


def test_grouped_walk_forward_never_splits_an_economic_chain_and_reserves_final_oos():
    observations = []
    for day in range(1, 9):
        observations.extend([
            ValidationObservation(f"{day}-entry", f"chain-{day}", f"2026-01-{day:02d}T14:00:00+00:00"),
            ValidationObservation(f"{day}-exit", f"chain-{day}", f"2026-01-{day:02d}T20:00:00+00:00"),
        ])
    plan = build_grouped_walk_forward_plan(observations, WalkForwardConfig(
        train_groups=2, validation_groups=1, forward_groups=1, step_groups=1, embargo_groups=1, final_oos_groups=1,
    ))
    assert len(plan.splits) == 2
    assert plan.final_oos_ids == ("8-entry", "8-exit")
    for split in plan.splits:
        partitions = [set(split.train_ids), set(split.validation_ids), set(split.forward_ids), set(plan.final_oos_ids)]
        assert all(not left.intersection(right) for index, left in enumerate(partitions) for right in partitions[index + 1:])
        for day in range(1, 9):
            assert not ((f"{day}-entry" in set().union(*partitions)) ^ (f"{day}-exit" in set().union(*partitions)))


def test_calibration_metrics_are_exact_and_empty_input_stays_unknown():
    metrics = calibration_metrics([0.1, 0.9], [0, 1], bin_count=2)
    assert isclose(metrics.brier_score or 0, 0.01)
    assert isclose(metrics.expected_calibration_error or 0, 0.1)
    empty = calibration_metrics([], [], bin_count=5)
    assert empty.brier_score is None
    assert empty.log_loss is None


def test_platt_and_isotonic_require_caller_defined_sufficiency_and_both_classes():
    assert fit_platt_scaler([1.0], [1], minimum_samples=2) is None
    assert fit_isotonic_calibrator([1.0, 2.0], [1, 1], minimum_samples=2) is None

    scores = [-3.0, -2.0, -1.0, 1.0, 2.0, 3.0]
    # Deliberately not perfectly separable. Perfect separation has no finite
    # maximum-likelihood Platt coefficient and must not be used as a fit test.
    labels = [0, 0, 1, 0, 1, 1]
    platt = fit_platt_scaler(scores, labels, minimum_samples=6)
    isotonic = fit_isotonic_calibrator(scores, labels, minimum_samples=6)
    assert platt is not None
    assert isotonic is not None
    assert platt.predict(-2.0) < platt.predict(2.0)
    predictions = [isotonic.predict(score) for score in scores]
    assert predictions == sorted(predictions)
