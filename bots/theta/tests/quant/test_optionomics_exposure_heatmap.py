"""Tests for bots/theta/quant/research/optionomics_exposure_heatmap.py. Synthetic fixtures only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from research.optionomics_exposure_heatmap import (  # noqa: E402
    HeatmapMetric,
    grid_value_range,
    nearest_cell_to_strike,
    parse_exposure_heatmap,
)


def _normalized(metric="vanna_exposure", cells=None, strikes=None, expirations=None):
    return {
        "metric": metric,
        "strikes": strikes if strikes is not None else [95.0, 100.0, 105.0],
        "expirations": expirations if expirations is not None else ["2026-10-17"],
        "cells": cells if cells is not None else [
            {"strike": 95.0, "expiration": "2026-10-17", "value": -1200.0},
            {"strike": 100.0, "expiration": "2026-10-17", "value": 300.0},
            {"strike": 105.0, "expiration": "2026-10-17", "value": 900.0},
        ],
        "valueUnits": "PROVIDER_REPORTED_UNVERIFIED",
        "signConvention": "PROVIDER_DEFINITION_UNVERIFIED",
    }


class ParseExposureHeatmapTests(unittest.TestCase):
    def test_metric_mismatch_refuses_to_parse(self):
        normalized = _normalized(metric="gamma_exposure")
        result = parse_exposure_heatmap(HeatmapMetric.VANNA_EXPOSURE, normalized)
        self.assertIsNone(result)

    def test_matching_metric_parses_correctly(self):
        result = parse_exposure_heatmap(HeatmapMetric.VANNA_EXPOSURE, _normalized(metric="vanna_exposure"))
        self.assertIsNotNone(result)
        self.assertEqual(result.metric, HeatmapMetric.VANNA_EXPOSURE)
        self.assertEqual(len(result.cells), 3)
        self.assertTrue(result.populated)

    def test_units_and_sign_convention_always_carried_as_unverified(self):
        result = parse_exposure_heatmap(HeatmapMetric.CHARM_EXPOSURE, _normalized(metric="charm_exposure"))
        self.assertEqual(result.value_units, "PROVIDER_REPORTED_UNVERIFIED")
        self.assertEqual(result.sign_convention, "PROVIDER_DEFINITION_UNVERIFIED")

    def test_empty_cells_list_is_not_populated(self):
        result = parse_exposure_heatmap(HeatmapMetric.GAMMA_EXPOSURE, _normalized(metric="gamma_exposure", cells=[]))
        self.assertIsNotNone(result)
        self.assertFalse(result.populated)

    def test_missing_cells_field_refuses_to_parse(self):
        normalized = _normalized(metric="vanna_exposure")
        del normalized["cells"]
        self.assertIsNone(parse_exposure_heatmap(HeatmapMetric.VANNA_EXPOSURE, normalized))

    def test_malformed_cell_entries_are_skipped_not_guessed(self):
        normalized = _normalized(metric="vanna_exposure", cells=[
            {"strike": 100.0, "expiration": "2026-10-17", "value": 50.0},
            "not-a-cell-object",
            {"strike": None, "expiration": "2026-10-17", "value": None},
        ])
        result = parse_exposure_heatmap(HeatmapMetric.VANNA_EXPOSURE, normalized)
        self.assertEqual(len(result.cells), 2)  # the string entry is dropped, not force-parsed


class NearestCellTests(unittest.TestCase):
    def test_finds_the_closest_strike(self):
        grid = parse_exposure_heatmap(HeatmapMetric.VANNA_EXPOSURE, _normalized())
        cell = nearest_cell_to_strike(grid, 103.0)
        self.assertEqual(cell.strike, 105.0)

    def test_none_when_grid_has_no_known_strikes(self):
        normalized = _normalized(cells=[{"strike": None, "expiration": "2026-10-17", "value": 5.0}])
        grid = parse_exposure_heatmap(HeatmapMetric.VANNA_EXPOSURE, normalized)
        self.assertIsNone(nearest_cell_to_strike(grid, 100.0))

    def test_restricts_to_one_expiration_when_given(self):
        normalized = _normalized(cells=[
            {"strike": 100.0, "expiration": "2026-10-17", "value": 1.0},
            {"strike": 100.0, "expiration": "2026-11-14", "value": 2.0},
        ])
        grid = parse_exposure_heatmap(HeatmapMetric.VANNA_EXPOSURE, normalized)
        cell = nearest_cell_to_strike(grid, 100.0, expiration="2026-11-14")
        self.assertEqual(cell.value, 2.0)


class GridValueRangeTests(unittest.TestCase):
    def test_computes_min_max_over_known_values(self):
        grid = parse_exposure_heatmap(HeatmapMetric.VANNA_EXPOSURE, _normalized())
        value_range = grid_value_range(grid)
        self.assertEqual(value_range, (-1200.0, 900.0))

    def test_none_when_no_cell_has_a_known_value(self):
        normalized = _normalized(cells=[{"strike": 100.0, "expiration": "2026-10-17", "value": None}])
        grid = parse_exposure_heatmap(HeatmapMetric.VANNA_EXPOSURE, normalized)
        self.assertIsNone(grid_value_range(grid))


if __name__ == "__main__":
    unittest.main()
