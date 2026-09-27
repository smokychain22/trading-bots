"""Future capture contract: one authoritative registry for fields this
research layer cannot observe today but needs once real Paper/live
execution and lifecycle events exist (work package 67).

This is a REGISTRY of what to capture and how, not a claim that any of it
is captured yet. `fill_dataset.py` (WP50) already names a narrower list of
fill-outcome fields inline; this registry is the authoritative superset
covering fills, assignment/exercise/expiration, future market observations,
and management/whole-chain outcomes, each with a full contract, and each
required field owned by Codex gets an exact, generated handoff record.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple
from research.production_export_loader import canonical_json, sha256_hex

STORAGE_CLASSES = ('SOURCE_CONTROL', 'LOCAL_ANALYTICS', 'ARCHIVE', 'EPHEMERAL', 'COMPACT_DB_HANDOFF')
PRODUCER_OWNERS = ('CODEX', 'CLAUDE', 'EXTERNAL_PROVIDER')


@dataclass(frozen=True)
class FutureCaptureFieldSpec:
    field_id: str
    meaning: str
    producer_owner: str
    source_provider: str
    truth_class: str
    as_of_semantics: str
    retrieved_at_semantics: str
    pit_cutoff_rule: str
    storage_class: str
    schema_version: str
    maturation_horizon: str
    consumer: str
    required: bool
    missing_behavior: str
    size_budget_bytes: Optional[int]

    def __post_init__(self) -> None:
        if self.producer_owner not in PRODUCER_OWNERS:
            raise ValueError(f'FUTURE_CAPTURE_UNKNOWN_PRODUCER_OWNER:{self.field_id}')
        if self.storage_class not in STORAGE_CLASSES:
            raise ValueError(f'FUTURE_CAPTURE_UNKNOWN_STORAGE_CLASS:{self.field_id}')
        if self.missing_behavior != 'UNKNOWN_NEVER_ZERO_OR_FABRICATED':
            raise ValueError(f'FUTURE_CAPTURE_MISSING_BEHAVIOR_MUST_BE_UNKNOWN_NEVER_ZERO:{self.field_id}')


def _spec(field_id: str, meaning: str, *, provider: str, truth_class: str, maturation: str, consumer: str,
          required: bool, size_budget: Optional[int]) -> FutureCaptureFieldSpec:
    return FutureCaptureFieldSpec(
        field_id=field_id, meaning=meaning, producer_owner='CODEX', source_provider=provider,
        truth_class=truth_class, as_of_semantics='the broker/lifecycle event timestamp, not the observation time',
        retrieved_at_semantics='when Codex\'s runtime actually persisted the evidence',
        pit_cutoff_rule='never readable by any decision whose decision_time precedes this field\'s as_of',
        storage_class='ARCHIVE', schema_version='theta-future-capture-contract-v1', maturation_horizon=maturation,
        consumer=consumer, required=required, missing_behavior='UNKNOWN_NEVER_ZERO_OR_FABRICATED',
        size_budget_bytes=size_budget,
    )


FUTURE_CAPTURE_REGISTRY: Tuple[FutureCaptureFieldSpec, ...] = (
    _spec('filled', 'whether an order actually filled', provider='ALPACA', truth_class='BROKER_ACTUAL',
          maturation='AT_FILL_OR_CANCEL', consumer='fill_dataset.py/fill_probability_baseline.py', required=True, size_budget=64),
    _spec('fill_price', 'the actual executed price of a filled order', provider='ALPACA', truth_class='BROKER_ACTUAL',
          maturation='AT_FILL', consumer='fill_dataset.py/cost_slippage_baseline.py', required=True, size_budget=64),
    _spec('fill_latency_seconds', 'time from order submission to fill', provider='ALPACA', truth_class='BROKER_ACTUAL',
          maturation='AT_FILL', consumer='fill_dataset.py', required=False, size_budget=64),
    _spec('partial_fill_quantity', 'quantity filled if not fully filled', provider='ALPACA', truth_class='BROKER_ACTUAL',
          maturation='AT_FILL_OR_CANCEL', consumer='fill_dataset.py', required=False, size_budget=64),
    _spec('cancel_replace_count', 'number of cancel/replace cycles before resolution', provider='ALPACA',
          truth_class='BROKER_ACTUAL', maturation='AT_FILL_OR_CANCEL', consumer='fill_dataset.py', required=False, size_budget=64),
    _spec('assignment_event', 'a real broker assignment/exercise notice', provider='ALPACA', truth_class='BROKER_ACTUAL',
          maturation='OVERNIGHT_AFTER_EXPIRATION', consumer='assignment_labels.py', required=True, size_budget=256),
    _spec('exercise_event', 'a real broker exercise notice (long option side)', provider='ALPACA',
          truth_class='BROKER_ACTUAL', maturation='OVERNIGHT_AFTER_EXPIRATION', consumer='assignment_labels.py',
          required=True, size_budget=256),
    _spec('expiration_outcome', 'the resolved lifecycle state at/after expiration', provider='ALPACA',
          truth_class='BROKER_ACTUAL', maturation='AT_EXPIRATION_PLUS_SETTLEMENT_LAG', consumer='expiration_outcome.py',
          required=True, size_budget=256),
    _spec('future_bbo', 'a later bid/ask observation for an already-decided contract', provider='ALPACA',
          truth_class='MARKET_OBSERVED', maturation='HORIZON_DEPENDENT', consumer='horizon_adapters.py',
          required=False, size_budget=128),
    _spec('future_underlying_price', 'a later underlying price observation', provider='ALPACA',
          truth_class='MARKET_OBSERVED', maturation='HORIZON_DEPENDENT', consumer='horizon_adapters.py',
          required=False, size_budget=64),
    _spec('future_iv', 'a later implied-volatility observation for the same contract', provider='OPTIONOMICS',
          truth_class='MARKET_OBSERVED', maturation='HORIZON_DEPENDENT', consumer='horizon_adapters.py',
          required=False, size_budget=64),
    _spec('future_greeks', 'later Greeks (delta/gamma/theta/vega) for the same contract', provider='OPTIONOMICS',
          truth_class='MARKET_OBSERVED', maturation='HORIZON_DEPENDENT', consumer='horizon_adapters.py',
          required=False, size_budget=128),
    _spec('management_action_taken', 'the real management action actually executed (vs. proposed)', provider='ALPACA',
          truth_class='BROKER_ACTUAL', maturation='AT_MANAGEMENT_EVENT', consumer='management_dataset.py',
          required=True, size_budget=128),
    _spec('management_outcome', 'the realized economic result of a management action', provider='ALPACA',
          truth_class='BROKER_ACTUAL', maturation='AT_MANAGEMENT_EVENT_PLUS_SETTLEMENT_LAG',
          consumer='management_dataset.py', required=True, size_budget=128),
    _spec('whole_chain_state', 'the resolved lifecycle state of the entire economic chain', provider='ALPACA',
          truth_class='BROKER_ACTUAL', maturation='AT_CHAIN_CLOSE', consumer='whole_chain_dataset.py',
          required=True, size_budget=256),
)
FUTURE_CAPTURE_REGISTRY_BY_ID = {spec.field_id: spec for spec in FUTURE_CAPTURE_REGISTRY}
if len(FUTURE_CAPTURE_REGISTRY_BY_ID) != len(FUTURE_CAPTURE_REGISTRY):
    raise AssertionError('FUTURE_CAPTURE_REGISTRY_DUPLICATE_FIELD_ID')


def build_codex_handoff(field_id: str, claude_sha: str) -> dict:
    """Generates one exact Codex handoff record for a required field this
    research layer cannot produce itself. Raises for an optional field --
    a handoff is only warranted when research work is genuinely blocked on
    it, never generated speculatively for a nice-to-have."""
    spec = FUTURE_CAPTURE_REGISTRY_BY_ID.get(field_id)
    if spec is None:
        raise ValueError(f'FUTURE_CAPTURE_UNKNOWN_FIELD_ID:{field_id}')
    if not spec.required:
        raise ValueError(f'FUTURE_CAPTURE_HANDOFF_ONLY_FOR_REQUIRED_FIELDS:{field_id}')
    payload = {
        'handoffId': f'HANDOFF-FUTURE-CAPTURE-{field_id.upper()}',
        'claudeSha': claude_sha,
        'sourceSchema': 'research.future_capture_contract.FutureCaptureFieldSpec',
        'targetSchema': f'Codex runtime persistence for {field_id}',
        'exportedSymbol': f'research.future_capture_contract.FUTURE_CAPTURE_REGISTRY_BY_ID[{field_id!r}]',
        'codexTargetLayer': 'bots/theta/app/ (execution/lifecycle/accounting)',
        'input': spec.meaning, 'output': f'a persisted {spec.field_id} evidence row, truth_class={spec.truth_class}',
        'persistence': spec.storage_class,
        'errorBehavior': 'missing -> UNKNOWN, never zero/default/fabricated',
        'acceptanceTest': f'a decision made before this field\'s as_of never reads it (PIT cutoff enforced)',
    }
    return {**payload, 'contentHash': sha256_hex(canonical_json(payload))}
