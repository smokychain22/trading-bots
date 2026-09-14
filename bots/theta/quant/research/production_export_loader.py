"""R6H research-side loader/validator for Codex's Production dataset export.

The scientific intake gate between `src/research/postgres-dataset-
export.ts`'s `DatasetExportArtifact` and any THETA research code. Fails
LOUDLY on any schema-version mismatch, dataset-hash mismatch, duplicate
identity, missing lineage, out-of-order rows, or future-label
contamination -- there is no best-effort parsing path, no silently
ignored column, and no enum value that falls back to a default.

Hashing/canonicalization here mirrors `point-in-time-evidence.ts`'s own
`canonicalize`/`canonicalJson`/`sha256` functions (sorted-key JSON, then
SHA-256 hex). Strings retain Unicode and finite numbers use ECMAScript
`JSON.stringify` formatting, including its fixed/scientific notation
boundaries, so Python verifies the exact Production TypeScript identity.
"""

from __future__ import annotations

import json
import math
import re
from decimal import Decimal
from dataclasses import dataclass
from typing import Any, Dict, List, Sequence

from research.dataset_contracts import (
    Candidate,
    CandidateSet,
    CompletenessState,
    DataQuality,
    EconomicEpisode,
    ExecutionEvidence,
    HardStatus,
    LifecycleEvent,
    ManagementActionValue,
    ManagementSnapshot,
    ObservationRole,
    ProviderProvenance,
    ShadowCandidate,
    SoftStatus,
    StrategyLineage,
    SubjectType,
    ThetaStrategyAction,
    ThetaStrategyBranch,
)

DATASET_SCHEMA_VERSION = "theta-r6-dataset-v1"  # mirrors point-in-time-evidence.ts's datasetExportVersion exactly


class DatasetLoadError(Exception):
    """Raised for ANY structural, hash, ordering, identity, lineage, unit,
    or firewall violation -- this loader never degrades to a warning."""


def _optional_float(value: Any, field: str) -> Any:
    if value is None:
        return None
    if isinstance(value, bool):
        raise DatasetLoadError(f"INVALID_NUMERIC_VALUE:{field}")
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise DatasetLoadError(f"INVALID_NUMERIC_VALUE:{field}") from None
    if not math.isfinite(parsed):
        raise DatasetLoadError(f"INVALID_NUMERIC_VALUE:{field}")
    return parsed


def _ecmascript_key_sort(value: str) -> Any:
    """Match the localeCompare ordering used by the v1 TypeScript contract.

    Dataset object keys are restricted to the contract's ASCII identifiers.
    ICU's default ordering compares those identifiers case-insensitively first,
    then places lowercase before uppercase when only case differs.
    """
    return (
        value.casefold(),
        tuple(0 if character.islower() else 1 if character.isupper() else 0 for character in value),
    )


def _canonicalize(value: Any) -> Any:
    if isinstance(value, list):
        return [_canonicalize(v) for v in value]
    if isinstance(value, dict):
        return {k: _canonicalize(value[k]) for k in sorted(value.keys(), key=_ecmascript_key_sort)}
    return value


def _ecmascript_number(value: Any) -> str:
    """Serialize a finite JSON number like ECMAScript JSON.stringify.

    Python and JavaScript use compatible shortest-round-trip float
    representations, but select fixed versus scientific notation at different
    boundaries and format exponents differently. Production dataset hashes are
    created in TypeScript, so the research verifier must reproduce JavaScript's
    wire representation exactly rather than accepting a weakened comparison.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError("value must be a JSON number")
    if isinstance(value, int):
        return str(value)
    if not math.isfinite(value):
        raise DatasetLoadError("NON_FINITE_NUMBER_IN_DATASET_IDENTITY")
    if value == 0:
        return "0"

    absolute = abs(value)
    representation = repr(value).lower()
    if 1e-6 <= absolute < 1e21:
        if "e" in representation:
            representation = format(Decimal(representation), "f")
        return representation

    if "e" not in representation:
        return representation
    mantissa, exponent_text = representation.split("e", 1)
    exponent = int(exponent_text)
    sign = "+" if exponent >= 0 else "-"
    return f"{mantissa}e{sign}{abs(exponent)}"


def _canonical_json_text(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return _ecmascript_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(_canonical_json_text(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            f"{json.dumps(key, ensure_ascii=False)}:{_canonical_json_text(value[key])}"
            for key in sorted(value.keys(), key=_ecmascript_key_sort)
        ) + "}"
    raise DatasetLoadError(f"UNSUPPORTED_CANONICAL_JSON_TYPE:{type(value).__name__}")


def canonical_json(value: Any) -> str:
    """Return sorted-key JSON byte-compatible with Production TypeScript."""
    return _canonical_json_text(_canonicalize(value))


def sha256_hex(text: str) -> str:
    import hashlib

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# Union of (a) point-in-time-evidence.ts's own forbiddenFeatureKeys set and
# (b) the R6H directive's own explicit list -- a superset, never a subset,
# since a research-side firewall may be stricter than Production's without
# creating a schema mismatch (it only ever REJECTS more, never accepts a
# row Production's own validator would have rejected).
_FORBIDDEN_FEATURE_KEYS = frozenset({
    "wholechainnetpnl", "wholechainpnl", "managedepisodepnl", "managedepisodeoutcome",
    "returnonsecuredcapital", "returnpercapitaldaylabel", "maxadverseexcursion", "maxfavorableexcursion",
    "assignmentoutcome", "recoveryduration", "closeoutcome", "rolloutcome", "ccoutcome", "callawayoutcome",
    "realizedexecutioncost", "eventualrealizedpnl", "futureoutcome", "outcomelabel",
    # R6H directive item 6 additions:
    "realizedpnl", "futurepnl", "outcome", "result", "assignedafter", "recoveredafter",
    "futurefill", "futurequote", "futurereturn",
    # Production's recursive feature firewall also rejects these bare terms.
    "future", "pnl", "realizedreturn",
})


def _normalized_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def assert_no_future_labels(value: Any, path: str = "features") -> None:
    """Recursively (not just top-level) rejects any dict key matching the
    forbidden-key registry, after stripping non-alphanumerics and
    lowercasing -- mirrors `point-in-time-evidence.ts`'s own
    `assertNoFutureLabels`/`normalizedKey`, so a key like
    `Realized_PnL` or `realizedPnL` is caught identically on both sides."""
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            assert_no_future_labels(item, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        if _normalized_key(key) in _FORBIDDEN_FEATURE_KEYS:
            raise DatasetLoadError(f"FUTURE_LABEL_IN_FEATURE_PAYLOAD:{path}.{key}")
        assert_no_future_labels(item, f"{path}.{key}")


def _assert_pit_order(provider_ts: Any, ingestion_ts: Any, reference_ts: str, reference_name: str, row_id: str) -> None:
    from datetime import datetime

    def _parse(ts: str) -> datetime:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))

    reference = _parse(reference_ts)
    if provider_ts is not None and _parse(provider_ts) > reference:
        raise DatasetLoadError(f"PROVIDER_TIMESTAMP_AFTER_{reference_name}:{row_id}")
    if ingestion_ts is not None and _parse(ingestion_ts) < reference:
        raise DatasetLoadError(f"INGESTION_TIMESTAMP_BEFORE_{reference_name}:{row_id}")


def _load_provenance(raw: Dict[str, Any]) -> ProviderProvenance:
    provenance = ProviderProvenance(
        source=raw["source"], operation_alias=raw["operationAlias"],
        provider_timestamp=raw.get("providerTimestamp"), ingestion_timestamp=raw["ingestionTimestamp"],
        as_of=raw["asOf"], version=raw["version"], state=DataQuality(raw["state"]),
    )
    _assert_pit_order(provenance.provider_timestamp, provenance.ingestion_timestamp, provenance.as_of, "AS_OF", provenance.source)
    return provenance


def _load_candidate(raw: Dict[str, Any]) -> Candidate:
    for family in ("contract", "market", "volatility", "technical", "event", "flow", "ownership",
                    "account", "portfolio", "aegis", "execution", "knownEconomics"):
        assert_no_future_labels(raw.get(family, {}), path=f"candidate.{raw.get('candidateId', '?')}.{family}")

    lineage_raw = raw["lineage"]
    return Candidate(
        candidate_id=raw["candidateId"], decision_id=raw.get("decisionId"),
        fusion_snapshot_id=raw["fusionSnapshotId"], decision_time=raw["decisionTime"],
        branch=ThetaStrategyBranch(raw["branch"]), rank_at_decision=raw.get("rankAtDecision"),
        selected=bool(raw["selected"]), hard_status=HardStatus(raw["hardStatus"]),
        soft_status=SoftStatus(raw["softStatus"]), rejection_reason=raw.get("rejectionReason"),
        contract=raw.get("contract", {}), market=raw.get("market", {}), volatility=raw.get("volatility", {}),
        technical=raw.get("technical", {}), event=raw.get("event", {}), flow=raw.get("flow", {}),
        ownership=raw.get("ownership", {}), account=raw.get("account", {}), portfolio=raw.get("portfolio", {}),
        aegis=raw.get("aegis", {}), execution=raw.get("execution", {}), known_economics=raw.get("knownEconomics", {}),
        unknown_economics=tuple(raw.get("unknownEconomics", [])), hard_blockers=tuple(raw.get("hardBlockers", [])),
        soft_evidence=tuple(raw.get("softEvidence", [])),
        provider_provenance=tuple(_load_provenance(p) for p in raw.get("providerProvenance", [])),
        lineage=StrategyLineage(
            strategy_version=lineage_raw["strategyVersion"], risk_version=lineage_raw["riskVersion"],
            feature_version=lineage_raw["featureVersion"], cost_model_version=lineage_raw["costModelVersion"],
            regime_version=lineage_raw["regimeVersion"], execution_model_version=lineage_raw["executionModelVersion"],
        ),
        content_hash=raw.get("contentHash", ""),
    )


def _load_candidate_set(raw: Dict[str, Any]) -> CandidateSet:
    return CandidateSet(
        candidate_set_id=raw["candidateSetId"], decision_time=raw["decisionTime"],
        universe_evaluated=tuple(raw.get("universeEvaluated", [])),
        branches_considered=tuple(ThetaStrategyBranch(b) for b in raw.get("branchesConsidered", [])),
        counts=raw.get("counts", {}), best_candidate_id=raw.get("bestCandidateId"),
        second_best_candidate_id=raw.get("secondBestCandidateId"), best_rejected_candidate_id=raw.get("bestRejectedCandidateId"),
        completeness_state=CompletenessState(raw["completenessState"]), missing_scope=tuple(raw.get("missingScope", [])),
        content_hash=raw.get("contentHash", ""),
    )


def _load_execution_evidence(raw: Dict[str, Any]) -> ExecutionEvidence:
    evidence = ExecutionEvidence(
        quote_observation_id=raw["quoteObservationId"], candidate_id=raw.get("candidateId"),
        management_input_snapshot_id=raw.get("managementInputSnapshotId"),
        observation_role=ObservationRole(raw["observationRole"]), observed_at=raw["observedAt"],
        provider_timestamp=raw.get("providerTimestamp"), ingestion_timestamp=raw["ingestionTimestamp"],
        source=raw["source"], operation_alias=raw["operationAlias"], feed=raw.get("feed"),
        contract_version=raw["contractVersion"],
        bid=_optional_float(raw.get("bid"), "execution.bid"),
        ask=_optional_float(raw.get("ask"), "execution.ask"),
        bid_size=_optional_float(raw.get("bidSize"), "execution.bidSize"),
        ask_size=_optional_float(raw.get("askSize"), "execution.askSize"),
        proposed_limit=_optional_float(raw.get("proposedLimit"), "execution.proposedLimit"),
        data_quality=DataQuality(raw["dataQuality"]), content_hash=raw.get("contentHash", ""),
    )
    _assert_pit_order(evidence.provider_timestamp, evidence.ingestion_timestamp, evidence.observed_at, "OBSERVED_AT", evidence.quote_observation_id)
    if evidence.bid is not None and evidence.ask is not None and evidence.bid > evidence.ask:
        raise DatasetLoadError(f"CROSSED_BBO_INVALID:{evidence.quote_observation_id}")
    return evidence


def _load_economic_episode(raw: Dict[str, Any]) -> EconomicEpisode:
    assert_no_future_labels(raw.get("provenance", {}), path=f"episode.{raw.get('outcomeLabelId', '?')}.provenance")
    from research.dataset_contracts import CensoringState

    return EconomicEpisode(
        outcome_label_id=raw["outcomeLabelId"], subject_type=SubjectType(raw["subjectType"]),
        subject_id=raw["subjectId"], label_available_at=raw["labelAvailableAt"], label_version=raw["labelVersion"],
        censoring_state=CensoringState(raw["censoringState"]),
        whole_chain_net_pnl=_optional_float(raw.get("wholeChainNetPnl"), "episode.wholeChainNetPnl"),
        managed_episode_pnl=_optional_float(raw.get("managedEpisodePnl"), "episode.managedEpisodePnl"),
        return_on_secured_capital=_optional_float(raw.get("returnOnSecuredCapital"), "episode.returnOnSecuredCapital"),
        return_per_capital_day=_optional_float(raw.get("returnPerCapitalDay"), "episode.returnPerCapitalDay"),
        max_adverse_excursion=_optional_float(raw.get("maxAdverseExcursion"), "episode.maxAdverseExcursion"),
        max_favorable_excursion=_optional_float(raw.get("maxFavorableExcursion"), "episode.maxFavorableExcursion"),
        recovery_duration_days=_optional_float(raw.get("recoveryDurationDays"), "episode.recoveryDurationDays"),
        realized_execution_cost=_optional_float(raw.get("realizedExecutionCost"), "episode.realizedExecutionCost"), outcomes=raw.get("outcomes", {}),
        provenance=raw.get("provenance", {}), content_hash=raw.get("contentHash", ""),
    )


def _load_management_snapshot(raw: Dict[str, Any]) -> ManagementSnapshot:
    actions_raw = raw.get("actions", [])
    actions = tuple(
        ManagementActionValue(
            action=ThetaStrategyAction(a["action"]), feasible=bool(a["feasible"]),
            certain_cashflow=_optional_float(a.get("certainCashflow"), "management.certainCashflow"),
            estimated_future_value=_optional_float(a.get("estimatedFutureValue"), "management.estimatedFutureValue"),
            tail_risk_penalty=_optional_float(a.get("tailRiskPenalty"), "management.tailRiskPenalty"),
            capital_days_penalty=_optional_float(a.get("capitalDaysPenalty"), "management.capitalDaysPenalty"),
            execution_penalty=_optional_float(a.get("executionPenalty"), "management.executionPenalty"),
            utility=_optional_float(a.get("utility"), "management.utility"),
        )
        for a in actions_raw
    )
    return ManagementSnapshot(
        management_input_snapshot_id=raw["managementInputSnapshotId"], fusion_snapshot_id=raw["fusionSnapshotId"],
        chain_id=raw.get("chainId"), observed_at=raw["observedAt"], lifecycle_state=raw["lifecycleState"],
        input_fields=raw.get("inputFields", {}), unknown_fields=tuple(raw.get("unknownFields", [])),
        change_fields=raw.get("changeFields", {}), content_hash=raw.get("contentHash", ""),
        actions=actions, selected_action=ThetaStrategyAction(raw["selectedAction"]) if raw.get("selectedAction") else None,
        second_best_action=ThetaStrategyAction(raw["secondBestAction"]) if raw.get("secondBestAction") else None,
        decision_state=raw.get("decisionState"), reason_codes=tuple(raw.get("reasonCodes", [])),
    )


def _load_lifecycle_event(raw: Dict[str, Any]) -> LifecycleEvent:
    return LifecycleEvent(
        lifecycle_application_id=raw["lifecycleApplicationId"], evidence_key=raw["evidenceKey"],
        chain_id=raw["chainId"], event_kind=raw["eventKind"], provider_activity_ref_hash=raw.get("providerActivityRefHash"),
        transition_path=tuple(raw.get("transitionPath", [])), applied_at=raw["appliedAt"],
        result_hash=raw["resultHash"], detail=raw.get("detail", {}),
    )


_LEGACY_ROUTER_BRANCHES = {
    "THETA_Q": ThetaStrategyBranch.THETA_CONVENTIONAL,
    "THETA_H": ThetaStrategyBranch.THETA_HOLD_STRIKE,
    "THETA_A": ThetaStrategyBranch.THETA_RECOVERY,
    "THETA_C": ThetaStrategyBranch.THETA_CC,
    "THETA_D": ThetaStrategyBranch.THETA_DEFINED_RISK,
}


def _load_shadow_strategy_branch(value: Any) -> ThetaStrategyBranch:
    """Normalize unambiguous legacy router families at the research boundary.

    The immutable shadow-opportunity ledger predates canonical business branch
    names. THETA_R cannot be mapped without lifecycle state, so it remains a
    hard error rather than being guessed.
    """
    try:
        return ThetaStrategyBranch(value)
    except ValueError:
        if value == "THETA_R":
            raise DatasetLoadError("AMBIGUOUS_LEGACY_STRATEGY_BRANCH:THETA_R") from None
        mapped = _LEGACY_ROUTER_BRANCHES.get(value)
        if mapped is None:
            raise DatasetLoadError(f"UNSUPPORTED_STRATEGY_BRANCH:{value}") from None
        return mapped


def _load_shadow_candidate(raw: Dict[str, Any]) -> ShadowCandidate:
    return ShadowCandidate(
        opportunity_id=raw["opportunityId"], fusion_snapshot_id=raw["fusionSnapshotId"], observed_at=raw["observedAt"],
        underlying=raw["underlying"], contract_symbol=raw.get("contractSymbol"),
        strategy_branch=_load_shadow_strategy_branch(raw["strategyBranch"]),
        ev_net=_optional_float(raw.get("evNet"), "shadow.evNet"),
        tail_adjusted_ev=_optional_float(raw.get("tailAdjustedEv"), "shadow.tailAdjustedEv"),
        return_per_capital_day=_optional_float(raw.get("returnPerCapitalDay"), "shadow.returnPerCapitalDay"),
        capital_required=_optional_float(raw.get("capitalRequired"), "shadow.capitalRequired"),
        uncertainty=_optional_float(raw.get("uncertainty"), "shadow.uncertainty"),
        aegis_state=raw.get("aegisState"),
        recommended_quantity=_optional_float(raw.get("recommendedQuantity"), "shadow.recommendedQuantity"),
        execution_quality_acceptable=raw.get("executionQualityAcceptable"), outcome=raw.get("outcome"),
        wait_reason=raw.get("waitReason"), rejection_category=raw.get("rejectionCategory"),
        reasons=tuple(raw.get("reasons", [])), policy_version=raw["policyVersion"],
        model_versions=raw.get("modelVersions", {}),
    )


def _assert_unique_ids(rows: Sequence[Any], id_getter, label: str) -> None:
    seen = set()
    for row in rows:
        row_id = id_getter(row)
        if row_id in seen:
            raise DatasetLoadError(f"DUPLICATE_IDENTITY:{label}:{row_id}")
        seen.add(row_id)


def _assert_deterministic_order(rows: Sequence[Any], key_fn) -> None:
    keys = [key_fn(r) for r in rows]
    if keys != sorted(keys):
        raise DatasetLoadError("NON_DETERMINISTIC_ORDERING: rows are not in the canonical sort order the export contract guarantees")


@dataclass(frozen=True)
class LoadedDatasetExport:
    schema_version: str
    dataset_hash: str
    recomputed_hash: str
    hash_verified: bool
    source_window_start: str
    source_window_end: str
    exported_at: str
    feature_set_version: str
    strategy_versions: List[str]
    candidate_sets: List[CandidateSet]
    candidates: List[Candidate]
    shadow_candidates: List[ShadowCandidate]
    management_snapshots: List[ManagementSnapshot]
    lifecycle_outcomes: List[LifecycleEvent]
    whole_chain_outcomes: List[EconomicEpisode]
    execution_evidence: List[ExecutionEvidence]
    row_counts: Dict[str, int]


def load_dataset_export(raw: Dict[str, Any]) -> LoadedDatasetExport:
    """The single entry point. Raises `DatasetLoadError` on ANY structural
    problem -- schema-version mismatch, dataset-hash mismatch, duplicate
    identity, missing lineage, out-of-PIT-order timestamps, or a future
    label anywhere in a feature payload. Never returns a partially-loaded
    or best-effort result."""
    schema_version = raw.get("schemaVersion")
    if schema_version != DATASET_SCHEMA_VERSION:
        raise DatasetLoadError(f"SCHEMA_VERSION_MISMATCH: expected {DATASET_SCHEMA_VERSION!r}, got {schema_version!r}")

    rows_raw = raw["rows"]
    candidate_sets = [_load_candidate_set(r) for r in rows_raw.get("candidateSets", [])]
    candidates = [_load_candidate(r) for r in rows_raw.get("candidates", [])]
    shadow_candidates = [_load_shadow_candidate(r) for r in rows_raw.get("shadowCandidates", [])]
    management_snapshots = [_load_management_snapshot(r) for r in rows_raw.get("managementSnapshots", [])]
    lifecycle_outcomes = [_load_lifecycle_event(r) for r in rows_raw.get("lifecycleOutcomes", [])]
    whole_chain_outcomes = [_load_economic_episode(r) for r in rows_raw.get("wholeChainOutcomes", [])]
    execution_evidence = [_load_execution_evidence(r) for r in rows_raw.get("executionEvidence", [])]

    _assert_unique_ids(candidate_sets, lambda c: c.candidate_set_id, "candidate_set")
    _assert_unique_ids(candidates, lambda c: c.candidate_id, "candidate")
    _assert_unique_ids(execution_evidence, lambda e: e.quote_observation_id, "execution_evidence")
    _assert_unique_ids(whole_chain_outcomes, lambda e: e.outcome_label_id, "economic_episode")

    all_candidate_ids = {c.candidate_id for c in candidates}
    for candidate_set in candidate_sets:
        for field_name, cid in (("best", candidate_set.best_candidate_id), ("second_best", candidate_set.second_best_candidate_id),
                                  ("best_rejected", candidate_set.best_rejected_candidate_id)):
            if cid is not None and cid not in all_candidate_ids:
                raise DatasetLoadError(f"CANDIDATE_SET_REFERENCES_UNKNOWN_CANDIDATE:{candidate_set.candidate_set_id}:{field_name}={cid}")

    for row_family in (
        "candidateSets", "candidates", "shadowCandidates", "strategyFrontiers",
        "managementSnapshots", "lifecycleOutcomes", "wholeChainOutcomes", "executionEvidence",
    ):
        _assert_deterministic_order(rows_raw.get(row_family, []), canonical_json)

    # Must mirror TypeScript buildDatasetExport() exactly. exportedAt is
    # provenance about file creation and is deliberately excluded from
    # dataset identity, so an identical immutable window re-export hashes
    # to the same value.
    identity = {
        "schemaVersion": schema_version,
        "sourceWindow": raw["sourceWindow"],
        "featureSetVersion": raw["featureSetVersion"],
        "strategyVersions": sorted(set(raw.get("strategyVersions", []))),
        # Production already emits every row family in canonical order. Preserve
        # that order for identity and verify it above. Re-sorting here would make
        # the verifier itself a second dataset producer.
        "rows": rows_raw,
        "rowCounts": raw.get("rowCounts", {k: len(v) for k, v in rows_raw.items()}),
    }
    recomputed_hash = sha256_hex(canonical_json(identity))
    dataset_hash = raw.get("datasetHash", "")
    hash_verified = recomputed_hash == dataset_hash
    if not hash_verified:
        raise DatasetLoadError(
            f"DATASET_HASH_MISMATCH: recomputed {recomputed_hash} != declared {dataset_hash}"
        )

    return LoadedDatasetExport(
        schema_version=schema_version, dataset_hash=dataset_hash, recomputed_hash=recomputed_hash, hash_verified=hash_verified,
        source_window_start=raw["sourceWindow"]["start"], source_window_end=raw["sourceWindow"]["end"],
        exported_at=raw["exportedAt"], feature_set_version=raw["featureSetVersion"],
        strategy_versions=list(raw.get("strategyVersions", [])),
        candidate_sets=candidate_sets, candidates=candidates, shadow_candidates=shadow_candidates,
        management_snapshots=management_snapshots, lifecycle_outcomes=lifecycle_outcomes,
        whole_chain_outcomes=whole_chain_outcomes, execution_evidence=execution_evidence,
        row_counts=raw.get("rowCounts", {}),
    )
