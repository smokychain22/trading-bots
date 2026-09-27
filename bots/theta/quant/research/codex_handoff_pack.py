"""General Codex handoff pack generator (work package 86).

`future_capture_contract.py`'s `build_codex_handoff()` (WP67, unchanged)
generates this exact shape already, but only for its own registry of
unrecoverable fields. This module generalizes the same shape to any
runtime/app need Claude's research work surfaces, so every handoff this
repo produces -- whatever module identified the need -- looks identical
to Codex: `HANDOFF_ID`, `CLAUDE_SHA`, source/target schema or API,
exported symbol, Codex target layer, input/output, persistence, error
behavior, acceptance test. A handoff missing any of these fields is
rejected outright -- "do not send vague handoffs" is enforced here, not
just stated.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from research.production_export_loader import canonical_json, sha256_hex

_REQUIRED_FIELDS = (
    'handoff_id', 'claude_sha', 'source_schema_or_api', 'target_schema_or_api', 'exported_symbol',
    'codex_target_layer', 'input_description', 'output_description', 'persistence', 'error_behavior',
    'acceptance_test',
)


@dataclass(frozen=True)
class CodexHandoff:
    handoff_id: str
    claude_sha: str
    source_schema_or_api: str
    target_schema_or_api: str
    exported_symbol: str
    codex_target_layer: str
    input_description: str
    output_description: str
    persistence: str
    error_behavior: str
    acceptance_test: str
    content_hash: str = ''


def build_codex_handoff_pack(**fields: str) -> CodexHandoff:
    missing = [name for name in _REQUIRED_FIELDS if not fields.get(name)]
    if missing:
        raise ValueError(f'CODEX_HANDOFF_FIELD_REQUIRED:{missing[0]}')
    unexpected = [key for key in fields if key not in _REQUIRED_FIELDS]
    if unexpected:
        raise ValueError(f'CODEX_HANDOFF_UNEXPECTED_FIELD:{unexpected[0]}')
    codex_owned_prefixes = ('bots/theta/app/', 'src/', 'migrations/', 'infra/')
    if not any(fields['codex_target_layer'].startswith(prefix) for prefix in codex_owned_prefixes):
        raise ValueError('CODEX_HANDOFF_TARGET_LAYER_MUST_BE_CODEX_OWNED')
    payload = dict(fields)
    return CodexHandoff(**payload, content_hash=sha256_hex(canonical_json(payload)))
