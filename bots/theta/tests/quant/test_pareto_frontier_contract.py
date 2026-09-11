"""Contract tests for the production boundary around pareto_frontier.py. Synthetic data only."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from runtime.pareto_frontier_contract import CONTRACT_VERSION, evaluate_request  # noqa: E402

_ALL_NULL = {
    "grossCredit": None, "evNet": None, "calibratedPWin": None, "breakEvenWr": None, "edgeBuffer": None,
    "expectedTailLoss": None, "assignmentProbability": None, "severeDrawdownProbability": None,
    "capitalRequirement": None, "capitalDays": None, "returnPerCapitalDay": None, "liquiditySpreadPct": None,
    "fillProbability": None, "expectedSlippage": None, "modelUncertainty": None,
}


def _candidate(candidate_id: str, **overrides):
    c = {"candidateId": candidate_id, **_ALL_NULL}
    c.update(overrides)
    return c


def _request(candidates):
    return {"contractVersion": CONTRACT_VERSION, "snapshotId": "snap-1", "timestamp": "2026-09-10T14:30:00Z", "candidates": candidates}


class ParetoFrontierContractTests(unittest.TestCase):
    def test_strictly_dominated_candidate_is_eliminated(self):
        candidates = [
            _candidate("better", evNet=100.0, capitalRequirement=1000.0),
            _candidate("worse", evNet=50.0, capitalRequirement=1000.0),
        ]
        response = evaluate_request(_request(candidates))
        by_id = {r["candidateId"]: r for r in response["results"]}
        self.assertTrue(by_id["better"]["survivesFrontier"])
        self.assertFalse(by_id["worse"]["survivesFrontier"])
        self.assertEqual(by_id["worse"]["dominatedBy"], ["better"])

    def test_all_unknown_candidates_are_never_dominated_by_each_other(self):
        candidates = [_candidate("a"), _candidate("b")]
        response = evaluate_request(_request(candidates))
        self.assertTrue(all(r["survivesFrontier"] for r in response["results"]))

    def test_gross_credit_alone_does_not_determine_survival(self):
        # Higher gross credit but worse ev_net/tail risk must not survive
        # purely because of the raw-credit field -- it is deliberately not
        # a dominance dimension.
        candidates = [
            _candidate("high-credit-bad-ev", grossCredit=500.0, evNet=-10.0),
            _candidate("low-credit-good-ev", grossCredit=100.0, evNet=50.0),
        ]
        response = evaluate_request(_request(candidates))
        by_id = {r["candidateId"]: r for r in response["results"]}
        # Neither dominates the other since grossCredit isn't comparable --
        # only evNet is a known, comparable dimension in this pair, and
        # there's no other known dimension for the high-credit one to win on.
        self.assertTrue(by_id["low-credit-good-ev"]["survivesFrontier"])

    def test_duplicate_candidate_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "candidateId values must be unique"):
            evaluate_request(_request([_candidate("dup"), _candidate("dup")]))

    def test_wrong_contract_version_is_rejected(self):
        with self.assertRaises(ValueError):
            evaluate_request({**_request([_candidate("a")]), "contractVersion": "wrong"})

    def test_full_h_optional_dimensions_are_accepted_and_affect_dominance(self):
        candidates = [
            _candidate("better-ownership", evNet=50.0, ownershipQuality=0.9, underlying="SPY", strategyBranch="THETA_Q"),
            _candidate("worse-ownership", evNet=50.0, ownershipQuality=0.1, underlying="QQQ", strategyBranch="THETA_Q"),
        ]
        response = evaluate_request(_request(candidates))
        by_id = {r["candidateId"]: r for r in response["results"]}
        self.assertTrue(by_id["better-ownership"]["survivesFrontier"])
        self.assertFalse(by_id["worse-ownership"]["survivesFrontier"])

    def test_full_h_optional_dimensions_default_to_none_when_omitted(self):
        # No error, no fabricated favorable value -- omitting the new
        # fields entirely must behave exactly like the pre-full-H contract.
        response = evaluate_request(_request([_candidate("a", evNet=10.0), _candidate("b", evNet=5.0)]))
        by_id = {r["candidateId"]: r for r in response["results"]}
        self.assertTrue(by_id["a"]["survivesFrontier"])
        self.assertFalse(by_id["b"]["survivesFrontier"])


if __name__ == "__main__":
    unittest.main()
