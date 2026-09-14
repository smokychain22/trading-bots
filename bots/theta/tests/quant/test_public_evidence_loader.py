"""Tests for bots/theta/quant/public_evidence/loader.py and its cross-
references into bots/theta/quant/research/data/hypotheses.json."""

import sys
import unittest
from pathlib import Path

_QUANT_DIR = Path(__file__).resolve().parents[2] / "quant"
sys.path.insert(0, str(_QUANT_DIR))

from public_evidence.loader import (  # noqa: E402
    PublicEvidenceDataError,
    TIER_RANK,
    load_public_evidence_sources,
    parse_public_evidence_sources,
    strongest_tier_for_hypothesis,
    validate_hypothesis_cross_references,
)
from research.registry import load_hypotheses_raw  # noqa: E402


def _fixture_source(**overrides):
    base = {
        "source_id": "fixture_source", "title": "Fixture", "tier": "AUDITED_BENCHMARK_INDEX",
        "publisher": "Fixture Publisher", "url": "https://example.invalid", "retrieved_via": "fixture",
        "verified_claim": "A claim.", "does_not_prove": "A limit.", "applies_to_hypotheses": ["H-Q-01"],
    }
    return {**base, **overrides}


class LoadPublicEvidenceSourcesTests(unittest.TestCase):
    def test_loads_the_real_registry_without_error(self):
        sources = load_public_evidence_sources()
        self.assertGreaterEqual(len(sources), 4)

    def test_every_source_has_a_non_empty_does_not_prove_field(self):
        for source in load_public_evidence_sources().values():
            self.assertTrue(source.does_not_prove)

    def test_every_source_names_at_least_one_hypothesis(self):
        for source in load_public_evidence_sources().values():
            self.assertGreaterEqual(len(source.applies_to_hypotheses), 1)

    def test_rejects_an_unknown_tier(self):
        with self.assertRaises(PublicEvidenceDataError):
            parse_public_evidence_sources({"sources": [_fixture_source(tier="MADE_UP_TIER")]})

    def test_rejects_a_duplicate_source_id(self):
        with self.assertRaises(PublicEvidenceDataError):
            parse_public_evidence_sources({"sources": [_fixture_source(), _fixture_source()]})

    def test_rejects_a_missing_does_not_prove(self):
        with self.assertRaises(PublicEvidenceDataError):
            parse_public_evidence_sources({"sources": [_fixture_source(does_not_prove="")]})

    def test_rejects_empty_applies_to_hypotheses(self):
        with self.assertRaises(PublicEvidenceDataError):
            parse_public_evidence_sources({"sources": [_fixture_source(applies_to_hypotheses=[])]})

    def test_url_may_be_none_for_a_source_without_a_direct_link(self):
        sources = parse_public_evidence_sources({"sources": [_fixture_source(url=None)]})
        self.assertIsNone(sources["fixture_source"].url)


class TierRankTests(unittest.TestCase):
    def test_audited_benchmark_outranks_practitioner_study(self):
        self.assertGreater(TIER_RANK["AUDITED_BENCHMARK_INDEX"], TIER_RANK["TRANSPARENT_PRACTITIONER_STUDY"])

    def test_anecdote_is_the_weakest_tier(self):
        self.assertEqual(min(TIER_RANK.values()), TIER_RANK["ANECDOTE_UNVERIFIED"])

    def test_strongest_tier_for_hypothesis_finds_the_max(self):
        sources = load_public_evidence_sources()
        tier = strongest_tier_for_hypothesis(sources, "H-Q-01")
        self.assertEqual(tier, "AUDITED_BENCHMARK_INDEX")

    def test_none_when_hypothesis_has_no_linked_evidence(self):
        sources = load_public_evidence_sources()
        self.assertIsNone(strongest_tier_for_hypothesis(sources, "H-A-01"))


class CrossReferenceTests(unittest.TestCase):
    def test_real_registries_cross_reference_cleanly(self):
        sources = load_public_evidence_sources()
        hypotheses_raw = load_hypotheses_raw()
        validate_hypothesis_cross_references(sources, hypotheses_raw)  # must not raise

    def test_rejects_a_source_pointing_at_an_unknown_hypothesis(self):
        sources = load_public_evidence_sources()
        hypotheses_raw = [h for h in load_hypotheses_raw() if h["hypothesis_id"] != "H-Q-01"]
        with self.assertRaises(PublicEvidenceDataError):
            validate_hypothesis_cross_references(sources, hypotheses_raw)

    def test_rejects_a_hypothesis_pointing_at_an_unknown_source(self):
        sources = load_public_evidence_sources()
        hypotheses_raw = [dict(h) for h in load_hypotheses_raw()]
        hypotheses_raw[0] = {**hypotheses_raw[0], "public_evidence_refs": ["not_a_real_source_id"]}
        with self.assertRaises(PublicEvidenceDataError):
            validate_hypothesis_cross_references(sources, hypotheses_raw)

    def test_h_r_01_and_h_r_02_carry_the_same_practitioner_source_on_both_sides(self):
        hypotheses = {h["hypothesis_id"]: h for h in load_hypotheses_raw()}
        self.assertEqual(
            hypotheses["H-R-01"]["public_evidence_refs"],
            hypotheses["H-R-02"]["public_evidence_refs"],
        )


if __name__ == "__main__":
    unittest.main()
