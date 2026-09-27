"""Unified historical episode loader (THETA long-run build, work package
24).

Real search performed before writing this module: Sep16/Sep18/Sep21 named
in the master command do not exist anywhere in this repository or its
docs -- only Sep24 evidence was ever found (Phase 1 Zero-Unknown
Reclosure), and it lives in a SEPARATE local worker checkout's SQLite
evidence spool (`.theta-local-worker/evidence-spool/theta-evidence.sqlite`,
outside this repo's version control, per this repo's own storage
discipline against committing large SQLite files -- work package 56).
Sep16/Sep18/Sep21 are BLOCKED_DATA: no such evidence has ever been found
in this repository, in the other checkout, or in any doc.

This module is the one canonical interface every experiment should use
instead of hand-parsing JSON/SQLite per experiment (work package 24's
explicit instruction). `SqliteEvidenceSpoolEpisodeLoader` is the one real
adapter, targeting the EXACT schema Phase 1 already discovered and
documented (`envelope` table: decision_cycle_id, snapshot_id,
decision_as_of, source_sha, worker_id, payload_type, payload_json) --
tested against a synthetic fixture matching that real, already-verified
schema (labeled `SYNTHETIC_FIXTURE_MATCHING_REAL_SCHEMA`, never claimed as
the real Sep24 file itself, which lives on a specific machine's disk, not
in source control).
"""

import json
import sqlite3
from dataclasses import dataclass
from typing import Mapping, Optional, Sequence


@dataclass(frozen=True)
class HistoricalEpisodeRow:
    episode_id: str
    decision_timestamp: str
    source_path_or_store: str
    truth_class: str  # "REAL_HISTORICAL" | "SYNTHETIC_FIXTURE" -- never silently blended
    source_sha: Optional[str]
    candidate_identity: Optional[str]
    payload_type: str
    available_fields: Sequence[str]
    missing_fields: Sequence[str]
    raw_payload: Mapping[str, object]


# The exact real fields this loader knows how to check for, per payload
# type, from Phase 1's own real Sep24 schema discovery. A field absent from
# a real row is recorded as missing, never silently treated as present.
_EXPECTED_FIELDS_BY_PAYLOAD_TYPE: Mapping[str, Sequence[str]] = {
    "Q_READY": ("symbol", "qCandidateCount", "qDecision", "qReasonCodes", "frontierCandidates", "blockers"),
    "AEGIS_READY": ("symbol", "aegisState", "evidenceState"),
    "SIZING_READY": ("symbol", "selectedQuantity", "bindingState"),
    "DECISION_READY": ("symbol", "canonicalAction", "selectedCandidateId", "selectedOptionSymbol"),
}


def _fields_for_payload(payload_type: str, payload: Mapping[str, object]) -> tuple:
    expected = _EXPECTED_FIELDS_BY_PAYLOAD_TYPE.get(payload_type, tuple(payload.keys()))
    available = tuple(field for field in expected if field in payload)
    missing = tuple(field for field in expected if field not in payload)
    return available, missing


class SqliteEvidenceSpoolEpisodeLoader:
    """Loads real historical episodes from a real evidence-spool SQLite
    file matching the schema Phase 1 discovered (`envelope` table). The
    caller supplies the real file path -- this loader never assumes a
    default machine-specific path, since the real Sep24 spool lives
    outside this repository's own checkout and is not portable across
    machines."""

    def __init__(self, sqlite_path: str, truth_class: str = "REAL_HISTORICAL"):
        self._sqlite_path = sqlite_path
        self._truth_class = truth_class

    def load_episode(self, decision_cycle_id: str) -> Sequence[HistoricalEpisodeRow]:
        connection = sqlite3.connect(self._sqlite_path)
        try:
            cursor = connection.execute(
                "SELECT decision_cycle_id, snapshot_id, decision_as_of, source_sha, payload_type, payload_json "
                "FROM envelope WHERE decision_cycle_id = ? ORDER BY sequence_number",
                (decision_cycle_id,),
            )
            rows = []
            for row in cursor.fetchall():
                cycle_id, snapshot_id, decision_as_of, source_sha, payload_type, payload_json = row
                payload = json.loads(payload_json)
                available, missing = _fields_for_payload(payload_type, payload)
                candidate_identity = payload.get("selectedOptionSymbol") if isinstance(payload, dict) else None
                rows.append(HistoricalEpisodeRow(
                    episode_id=cycle_id, decision_timestamp=decision_as_of, source_path_or_store=self._sqlite_path,
                    truth_class=self._truth_class, source_sha=source_sha, candidate_identity=candidate_identity,
                    payload_type=payload_type, available_fields=available, missing_fields=missing, raw_payload=payload,
                ))
            return rows
        finally:
            connection.close()


def blocked_data_episode(episode_label: str, reason: str) -> HistoricalEpisodeRow:
    """The explicit BLOCKED_DATA representation for a named historical
    episode (Sep16/Sep18/Sep21) that was searched for and genuinely not
    found -- never silently omitted from a caller's inventory."""
    return HistoricalEpisodeRow(
        episode_id=episode_label, decision_timestamp="", source_path_or_store="NONE_FOUND",
        truth_class="BLOCKED_DATA", source_sha=None, candidate_identity=None, payload_type="NONE",
        available_fields=(), missing_fields=("ALL",), raw_payload={"blockedReason": reason},
    )
