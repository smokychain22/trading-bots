"""Tests for bots/theta/quant/expert_priors/loader.py.

Run with (from the repo root, once a Python toolchain is set up):
    python -m unittest discover -s bots/theta/tests/quant -p "test_*.py"
"""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from expert_priors import loader  # noqa: E402
from research import registry as research_registry  # noqa: E402


class ExpertSourceLoaderTests(unittest.TestCase):
    def test_loads_eleven_experts(self):
        experts = loader.load_expert_sources()
        self.assertEqual(len(experts), 11)

    def test_every_expert_is_evidence_class_d(self):
        # Every entry must be D_EXPERT_DNA (TRD section 0.1 level D) -- never
        # silently promoted to a stronger evidence class than the corpus
        # actually supports.
        experts = loader.load_expert_sources()
        for eid, e in experts.items():
            self.assertEqual(e.evidence_class, "D_EXPERT_DNA", eid)

    def test_failure_dna_expert_flagged(self):
        experts = loader.load_expert_sources()
        self.assertTrue(experts["sqqq_hold_the_strike"].is_failure_dna)

    def test_no_duplicate_ids(self):
        experts = loader.load_expert_sources()
        # load_expert_sources itself raises on duplicates; reaching here at
        # all with 11 distinct keys is the assertion.
        self.assertEqual(len(set(experts.keys())), len(experts))


class ExpertArchetypeMapCrossReferenceTests(unittest.TestCase):
    def test_cross_references_are_valid(self):
        experts = loader.load_expert_sources()
        mappings = loader.load_expert_archetype_map()
        archetype_ids = research_registry.load_archetype_ids()
        # Raises ExpertPriorDataError on any violation -- reaching the end of
        # this test is the assertion.
        loader.validate_cross_references(experts, mappings, archetype_ids)

    def test_every_expert_mapped_to_at_least_one_archetype(self):
        mappings = loader.load_expert_archetype_map()
        for m in mappings:
            self.assertGreater(len(m.archetype_ids), 0, m.expert_source_id)

    def test_sqqq_is_mapped_to_every_archetype_as_cross_cutting(self):
        mappings = {m.expert_source_id: m for m in loader.load_expert_archetype_map()}
        archetype_ids = research_registry.load_archetype_ids()
        sqqq_archetypes = set(mappings["sqqq_hold_the_strike"].archetype_ids)
        self.assertEqual(sqqq_archetypes, archetype_ids)


if __name__ == "__main__":
    unittest.main()
