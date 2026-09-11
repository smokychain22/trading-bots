"""OpportunityCapture research metric (R6E item 15).

OpportunityCapture = selected positive-EV opportunities / detected
positive-EV opportunities -- ONLY computable once real empirical EV exists.
Until then this module reports UNKNOWN, never pretends a rule-filtered
candidate is positive-EV simply because it passed a hard/soft gate (a gate
pass is a STRUCTURAL survival fact, not an economic one).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class OpportunityCaptureInputs:
    selected_positive_ev_count: int
    detected_positive_ev_count: Optional[int]  # None until empirical EV exists -- never inferred from gate-pass counts


@dataclass(frozen=True)
class OpportunityCaptureResult:
    opportunity_capture: Optional[float]
    reason: str


def compute_opportunity_capture(inputs: OpportunityCaptureInputs) -> OpportunityCaptureResult:
    """Returns `opportunity_capture=None` (UNKNOWN) whenever
    `detected_positive_ev_count` is None (no empirical EV model exists yet)
    or zero (nothing to have captured), or when `selected_positive_ev_count`
    exceeds it (a bookkeeping error upstream -- never silently clipped to
    1.0, which would hide the bug)."""
    if inputs.detected_positive_ev_count is None:
        return OpportunityCaptureResult(None, "detected_positive_ev_count is unknown -- no empirical EV model exists yet (EV_MODEL_NOT_EMPIRICALLY_READY)")
    if inputs.detected_positive_ev_count == 0:
        return OpportunityCaptureResult(None, "zero detected positive-EV opportunities -- no capture rate to report")
    if inputs.selected_positive_ev_count > inputs.detected_positive_ev_count:
        return OpportunityCaptureResult(None, "selected_positive_ev_count exceeds detected_positive_ev_count -- a bookkeeping error upstream, never silently clipped")
    return OpportunityCaptureResult(
        inputs.selected_positive_ev_count / inputs.detected_positive_ev_count,
        f"{inputs.selected_positive_ev_count} of {inputs.detected_positive_ev_count} detected positive-EV opportunities were selected",
    )
