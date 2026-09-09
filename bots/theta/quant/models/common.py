"""Shared, dependency-free primitives used across bots/theta/quant/models/.

Kept deliberately tiny -- this is not a framework, just the one shared shape
(ReasonCode) that every transparent model in this package uses so outputs
stay comparable and reason-coded rather than opaque scalars (TRD CAND-003).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ReasonCode:
    code: str
    polarity: int  # -1 negative/risk, 0 neutral/informational, 1 positive
    detail: str
