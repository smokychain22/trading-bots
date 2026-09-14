"""Loads and validates public_evidence_sources.json -- the R7 "STRATEGY EDGE
DISCOVERY PROGRAM" directive's section-1 evidence hierarchy (Cboe benchmark
indices, peer-reviewed academic research, transparent practitioner studies).

Distinct from bots/theta/quant/expert_priors/loader.py: that module holds a
private, anonymized trader corpus (evidence_class D_EXPERT_DNA throughout,
per the TRD's own evidence-class ladder). This module holds NAMED, publicly
citable sources with a real URL (or an explicit reason one isn't given) and
its own, coarser tier system, mirroring the directive's own hierarchy rather
than the TRD's five-level A-F ladder.

Every entry's tier is a claim about the SOURCE's own rigor, never about how
much it proves for THETA specifically -- every entry also carries a
mandatory `does_not_prove` field forcing that distinction to stay explicit
in the data itself, not just in a docstring a future reader might skip.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set

_DATA_DIR = Path(__file__).resolve().parent / "data"

EVIDENCE_TIERS = {
    "AUDITED_BENCHMARK_INDEX",
    "PEER_REVIEWED_ACADEMIC",
    "TRANSPARENT_PRACTITIONER_STUDY",
    "ANECDOTE_UNVERIFIED",
}

#: Ordinal rank for comparing tier strength -- higher is stronger evidence.
#: ANECDOTE_UNVERIFIED is intentionally the weakest and, per the directive,
#: is never sufficient on its own to promote a strategy.
TIER_RANK = {
    "ANECDOTE_UNVERIFIED": 0,
    "TRANSPARENT_PRACTITIONER_STUDY": 1,
    "PEER_REVIEWED_ACADEMIC": 2,
    "AUDITED_BENCHMARK_INDEX": 3,
}


class PublicEvidenceDataError(ValueError):
    """Raised when public_evidence_sources.json fails structural or
    cross-reference validation."""


@dataclass(frozen=True)
class PublicEvidenceSource:
    source_id: str
    title: str
    tier: str
    publisher: str
    url: Optional[str]
    retrieved_via: str
    verified_claim: str
    does_not_prove: str
    applies_to_hypotheses: List[str]


def load_public_evidence_sources() -> Dict[str, PublicEvidenceSource]:
    """Loads public_evidence_sources.json, keyed by source_id. See
    parse_public_evidence_sources for the validation rules applied."""
    raw = json.loads((_DATA_DIR / "public_evidence_sources.json").read_text(encoding="utf-8"))
    return parse_public_evidence_sources(raw)


def parse_public_evidence_sources(raw: dict) -> Dict[str, PublicEvidenceSource]:
    """Parses an already-loaded public-evidence registry object. Raises
    PublicEvidenceDataError on an unknown tier, a duplicate source_id, or a
    missing does_not_prove/verified_claim/applies_to_hypotheses field -- an
    entry that skips does_not_prove would silently blur exactly the
    distinction this registry exists to keep explicit. Split out from
    load_public_evidence_sources so tests can exercise validation against an
    in-memory fixture without touching the filesystem."""
    result: Dict[str, PublicEvidenceSource] = {}
    for entry in raw["sources"]:
        sid = entry["source_id"]
        if sid in result:
            raise PublicEvidenceDataError(f"duplicate source_id: {sid}")
        if entry["tier"] not in EVIDENCE_TIERS:
            raise PublicEvidenceDataError(f"{sid}: invalid tier {entry['tier']!r}")
        if not entry.get("verified_claim"):
            raise PublicEvidenceDataError(f"{sid}: missing verified_claim")
        if not entry.get("does_not_prove"):
            raise PublicEvidenceDataError(f"{sid}: missing does_not_prove -- every source must state its own limits")
        if not entry.get("applies_to_hypotheses"):
            raise PublicEvidenceDataError(f"{sid}: applies_to_hypotheses must name at least one hypothesis_id")
        result[sid] = PublicEvidenceSource(
            source_id=sid,
            title=entry["title"],
            tier=entry["tier"],
            publisher=entry["publisher"],
            url=entry.get("url"),
            retrieved_via=entry["retrieved_via"],
            verified_claim=entry["verified_claim"],
            does_not_prove=entry["does_not_prove"],
            applies_to_hypotheses=list(entry["applies_to_hypotheses"]),
        )
    return result


def validate_hypothesis_cross_references(
    sources: Dict[str, PublicEvidenceSource],
    hypotheses_raw: List[dict],
) -> None:
    """Validates that every source's applies_to_hypotheses names a real
    hypothesis_id, and that every hypothesis's own public_evidence_refs (if
    present) names a real source_id -- checked in both directions so a typo
    on either side of the link is caught, not silently ignored."""
    known_hypothesis_ids: Set[str] = {h["hypothesis_id"] for h in hypotheses_raw}
    for source in sources.values():
        for hid in source.applies_to_hypotheses:
            if hid not in known_hypothesis_ids:
                raise PublicEvidenceDataError(
                    f"public_evidence_sources.json: {source.source_id!r} references unknown hypothesis_id {hid!r}"
                )
    for h in hypotheses_raw:
        for ref in h.get("public_evidence_refs", []):
            if ref not in sources:
                raise PublicEvidenceDataError(
                    f"hypotheses.json: {h['hypothesis_id']!r} references unknown public evidence source_id {ref!r}"
                )


def strongest_tier_for_hypothesis(sources: Dict[str, PublicEvidenceSource], hypothesis_id: str) -> Optional[str]:
    """The highest-ranked tier among sources that apply to this hypothesis,
    or None if no public evidence has been linked yet. Never itself implies
    the hypothesis is confirmed -- see each source's does_not_prove field."""
    tiers = [s.tier for s in sources.values() if hypothesis_id in s.applies_to_hypotheses]
    if not tiers:
        return None
    return max(tiers, key=lambda t: TIER_RANK[t])
