"""Research-side immutable strategy configuration schema (R6F).

Implements THETA_STRATEGY_ENGINE_AND_IMPLEMENTATION_SPEC_v1.0 section 35's
exact field list as a real, hashable dataclass -- so "thresholds, feature/
model versions, cost assumptions, risk version, candidate lattice and
management policy cannot drift silently" is a checkable property, not just
a documentation promise. Reuses `reproducibility.py`'s canonical-JSON
hashing rather than inventing a second hashing scheme.

This is a RESEARCH-side schema only. It does not modify or replace any
Production schema/migration Codex owns; a Production `strategy_version` row
is a separate, Codex-owned artifact this config may inform but never
substitutes for.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

from research.reproducibility import _canonical_json, _sha256_hex


@dataclass(frozen=True)
class StrategyConfig:
    strategy_id: str
    strategy_version: str
    status: str  # SHADOW | PAPER_CHALLENGER | PAPER_CHAMPION | LIVE_SMALL_ELIGIBLE -- a research-recommended label only, never a Production activation
    providers: Tuple[str, ...]
    entry_model_version: str
    ownership_model_version: str
    management_model_version: str
    regime_model_version: str
    execution_model_version: str
    cost_model_version: str
    risk_limit_version: str
    feature_set_version: str
    candidate_lattice_dte: Tuple[int, int]
    candidate_lattice_delta_bins: Tuple[Tuple[float, float], ...]
    event_policy: str
    hard_rules: Tuple[str, ...]
    soft_features: Tuple[str, ...]
    management_policy_id: str
    promotion_evidence_hash: str

    def config_hash(self) -> str:
        """A single content hash of every field above -- two configs that
        differ in even one threshold, model version, or rule name hash
        differently, so silent drift becomes immediately detectable by
        comparing hashes rather than diffing every field by hand."""
        payload = {
            "strategy_id": self.strategy_id,
            "strategy_version": self.strategy_version,
            "status": self.status,
            "providers": sorted(self.providers),
            "entry_model_version": self.entry_model_version,
            "ownership_model_version": self.ownership_model_version,
            "management_model_version": self.management_model_version,
            "regime_model_version": self.regime_model_version,
            "execution_model_version": self.execution_model_version,
            "cost_model_version": self.cost_model_version,
            "risk_limit_version": self.risk_limit_version,
            "feature_set_version": self.feature_set_version,
            "candidate_lattice_dte": list(self.candidate_lattice_dte),
            "candidate_lattice_delta_bins": [list(b) for b in self.candidate_lattice_delta_bins],
            "event_policy": self.event_policy,
            "hard_rules": sorted(self.hard_rules),
            "soft_features": sorted(self.soft_features),
            "management_policy_id": self.management_policy_id,
            "promotion_evidence_hash": self.promotion_evidence_hash,
        }
        return _sha256_hex(_canonical_json(payload))
