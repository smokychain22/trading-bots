"""Phase 1 (Profitability Brain Completion Program) 1H residual closure.

Real, static source-scanning regression tests proving no second module
independently defines a risk-permission or sizing authority. These are
structural guards against a *future* duplicate being introduced -- not a
runtime behavioral proof (that would require exercising the real broker/
account inputs, out of this repository's current authority).
"""

import re
import unittest
from pathlib import Path

_MODELS_DIR = Path(__file__).resolve().parents[2] / "quant" / "models"

_AEGIS_FAMILY_NAMES = [
    "PER_TRADE", "UNDERLYING", "SECTOR", "CORRELATION", "PORTFOLIO",
    "INVENTORY", "ASSIGNMENT", "RECOVERY", "LIQUIDITY", "EXECUTION",
    "PROVIDER", "SYSTEM",
]

_SIZING_CAP_NAMES = [
    "RISK_BUDGET", "COLLATERAL_CAP", "CONCENTRATION_CAP",
    "ASSIGNMENT_CAPACITY_CAP", "TAIL_RISK_CAP", "CORRELATION_CAP",
    "LIQUIDITY_CAP",
]


def _all_python_files():
    return [p for p in _MODELS_DIR.parent.rglob("*.py") if "__pycache__" not in str(p)]


class SingleAegisAuthorityTests(unittest.TestCase):
    def test_only_aegis_py_references_all_twelve_risk_families_together(self):
        offenders = []
        for path in _all_python_files():
            if path.name == "aegis.py":
                continue
            text = path.read_text(encoding="utf-8")
            if all(name in text for name in _AEGIS_FAMILY_NAMES):
                offenders.append(str(path))
        self.assertEqual(
            offenders, [],
            f"Found a file other than aegis.py referencing all 12 risk families together: {offenders}",
        )

    def test_only_aegis_py_defines_assess_aegis(self):
        offenders = []
        for path in _all_python_files():
            text = path.read_text(encoding="utf-8")
            if re.search(r"^def assess_aegis\(", text, re.MULTILINE) and path.name != "aegis.py":
                offenders.append(str(path))
        self.assertEqual(offenders, [])


class SingleSizingAuthorityTests(unittest.TestCase):
    def test_only_sizing_py_references_all_seven_named_caps_together(self):
        offenders = []
        for path in _all_python_files():
            if path.name == "sizing.py":
                continue
            text = path.read_text(encoding="utf-8")
            if all(name in text for name in _SIZING_CAP_NAMES):
                offenders.append(str(path))
        self.assertEqual(
            offenders, [],
            f"Found a file other than sizing.py referencing all 7 named sizing caps together: {offenders}",
        )

    def test_only_sizing_py_defines_compute_sizing(self):
        offenders = []
        for path in _all_python_files():
            text = path.read_text(encoding="utf-8")
            if re.search(r"^def compute_sizing\(", text, re.MULTILINE) and path.name != "sizing.py":
                offenders.append(str(path))
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
