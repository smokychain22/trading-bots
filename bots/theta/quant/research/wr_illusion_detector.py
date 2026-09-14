"""Detects fake-high-win-rate accounting illusions (R6 primary mission item:
"is the apparent 70-80% WR real or an accounting illusion?").

Every check here is a STRUCTURAL comparison between two numbers that a
biased reporting practice would make diverge -- it never asserts a
strategy is bad from win rate alone, and every result stays `None`
(never a fabricated verdict) until the inputs it needs are actually
known. This is CONTRACT/SHAPE work in the same pattern as
`action_value_distribution.py`: it specifies exactly what a real dataset
must supply to answer "is this WR real," and is exercised only against
synthetic fixtures until one exists.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional, Sequence


class IllusionPattern(str, Enum):
    MANY_SMALL_WINS_FEW_UNRESOLVED_LARGE_LOSSES = "MANY_SMALL_WINS_FEW_UNRESOLVED_LARGE_LOSSES"
    CLOSED_ONLY_SAMPLE_EXCLUDES_LOSERS = "CLOSED_ONLY_SAMPLE_EXCLUDES_LOSERS"
    OPEN_INVENTORY_EXCLUDED_FROM_DENOMINATOR = "OPEN_INVENTORY_EXCLUDED_FROM_DENOMINATOR"
    ROLL_LOSS_ERASURE = "ROLL_LOSS_ERASURE"
    EVENT_PERIOD_CHERRY_PICKING = "EVENT_PERIOD_CHERRY_PICKING"


@dataclass(frozen=True)
class IllusionFinding:
    pattern: IllusionPattern
    detected: Optional[bool]  # None until the inputs it needs are known -- never guessed
    evidence: str
    severity_note: str


@dataclass(frozen=True)
class WrIllusionInputs:
    """The minimal shape each check needs. Every field Optional; a check
    that needs a field left None reports `detected=None`, never False (a
    False result must mean "checked and not present," never "couldn't
    check")."""

    closed_trade_win_rate: Optional[float]  # option-leg/closed-trade WR only
    whole_chain_win_rate: Optional[float]  # includes every chain, open and closed
    open_chain_count: Optional[int]
    total_chain_count: Optional[int]
    avg_win_amount: Optional[float]
    avg_loss_amount: Optional[float]  # signed negative or magnitude -- caller must pass a positive magnitude
    unresolved_large_loss_count: Optional[int]  # open chains whose mark-to-market is a loss exceeding some caller-defined threshold
    reported_pnl_includes_roll_history: Optional[bool]  # True only if the reporting path sums ALL legs of every roll, per whole_episode_pnl's own invariant
    sample_window_excludes_known_stress_period: Optional[bool]  # True if the reporting window was chosen to omit a known high-vol/crash period


def _finding(pattern: IllusionPattern, detected: Optional[bool], evidence: str, severity_note: str) -> IllusionFinding:
    return IllusionFinding(pattern=pattern, detected=detected, evidence=evidence, severity_note=severity_note)


def check_many_small_wins_few_unresolved_losses(inputs: WrIllusionInputs, large_loss_count_floor: int) -> IllusionFinding:
    """Detects a classic short-premium illusion: high WR built from many
    small wins while a small number of UNRESOLVED (still-open) large
    losses have not yet been counted against it. `large_loss_count_floor`
    is REQUIRED, caller-supplied -- how many unresolved large losses count
    as "present" is a judgment call this module never makes unilaterally."""
    if inputs.unresolved_large_loss_count is None or inputs.avg_win_amount is None or inputs.avg_loss_amount is None:
        return _finding(
            IllusionPattern.MANY_SMALL_WINS_FEW_UNRESOLVED_LARGE_LOSSES, None,
            "unresolved_large_loss_count/avg_win_amount/avg_loss_amount unknown", "cannot assess until resolved",
        )
    detected = inputs.unresolved_large_loss_count >= large_loss_count_floor and inputs.avg_win_amount < inputs.avg_loss_amount
    return _finding(
        IllusionPattern.MANY_SMALL_WINS_FEW_UNRESOLVED_LARGE_LOSSES, detected,
        f"unresolved_large_loss_count={inputs.unresolved_large_loss_count}, avg_win={inputs.avg_win_amount}, avg_loss={inputs.avg_loss_amount}",
        "if detected, the reported WR describes realized wins only -- the true payoff ratio is unknown until those losses resolve",
    )


def check_closed_only_sample_excludes_losers(inputs: WrIllusionInputs, divergence_threshold: float) -> IllusionFinding:
    """Detects the censoring signature: closed-trade WR far exceeds
    whole-chain WR, meaning open (unresolved, disproportionately likely
    to be underwater) chains are being silently excluded from the
    headline number. `divergence_threshold` is REQUIRED, caller-supplied."""
    if inputs.closed_trade_win_rate is None or inputs.whole_chain_win_rate is None:
        return _finding(
            IllusionPattern.CLOSED_ONLY_SAMPLE_EXCLUDES_LOSERS, None,
            "closed_trade_win_rate/whole_chain_win_rate unknown", "cannot assess until resolved",
        )
    divergence = inputs.closed_trade_win_rate - inputs.whole_chain_win_rate
    detected = divergence > divergence_threshold
    return _finding(
        IllusionPattern.CLOSED_ONLY_SAMPLE_EXCLUDES_LOSERS, detected,
        f"closed_trade_win_rate={inputs.closed_trade_win_rate}, whole_chain_win_rate={inputs.whole_chain_win_rate}, divergence={divergence:.4f}",
        "if detected, report whole-chain WR as the headline number, never closed-trade WR alone",
    )


def check_open_inventory_excluded_from_denominator(inputs: WrIllusionInputs) -> IllusionFinding:
    """Detects whether open chains are simply missing from the sample
    entirely (not merely under-weighted) -- the most direct form of
    survivorship exclusion."""
    if inputs.open_chain_count is None or inputs.total_chain_count is None:
        return _finding(
            IllusionPattern.OPEN_INVENTORY_EXCLUDED_FROM_DENOMINATOR, None,
            "open_chain_count/total_chain_count unknown", "cannot assess until resolved",
        )
    detected = inputs.open_chain_count > 0 and inputs.total_chain_count == 0
    return _finding(
        IllusionPattern.OPEN_INVENTORY_EXCLUDED_FROM_DENOMINATOR, detected,
        f"open_chain_count={inputs.open_chain_count}, total_chain_count_in_sample={inputs.total_chain_count}",
        "if detected, the reported sample is not a valid population for any win-rate claim",
    )


def check_roll_loss_erasure(inputs: WrIllusionInputs) -> IllusionFinding:
    """Detects whether the reporting path even CLAIMS to include prior
    roll legs' realized P&L. This is a necessary, not sufficient, check --
    `episode_economics.whole_episode_pnl`'s own invariant
    ([200,-350,180,-15] == 15, never 195) is the authoritative arithmetic
    test; this function only checks whether the reporting path declares
    it follows that invariant at all."""
    if inputs.reported_pnl_includes_roll_history is None:
        return _finding(
            IllusionPattern.ROLL_LOSS_ERASURE, None,
            "reported_pnl_includes_roll_history unknown", "cannot assess until the reporting path is inspected",
        )
    detected = inputs.reported_pnl_includes_roll_history is False
    return _finding(
        IllusionPattern.ROLL_LOSS_ERASURE, detected,
        f"reported_pnl_includes_roll_history={inputs.reported_pnl_includes_roll_history}",
        "if detected, every reported number downstream of this reporting path is unreliable until fixed -- this is a REQUIRED_CODEX_CHANGE-caliber finding, not a research nuance",
    )


def check_event_period_cherry_picking(inputs: WrIllusionInputs) -> IllusionFinding:
    """Detects whether the sample window was chosen to specifically
    exclude a known high-volatility/crash period -- the caller supplies
    this as an explicit boolean (from comparing the reporting window
    against a documented list of known stress periods), never inferred
    from price data by this module."""
    if inputs.sample_window_excludes_known_stress_period is None:
        return _finding(
            IllusionPattern.EVENT_PERIOD_CHERRY_PICKING, None,
            "sample_window_excludes_known_stress_period unknown", "cannot assess until the reporting window is checked against known stress periods",
        )
    return _finding(
        IllusionPattern.EVENT_PERIOD_CHERRY_PICKING, inputs.sample_window_excludes_known_stress_period,
        f"sample_window_excludes_known_stress_period={inputs.sample_window_excludes_known_stress_period}",
        "if detected, the reported WR is not representative of the strategy's full-regime performance",
    )


def run_all_illusion_checks(
    inputs: WrIllusionInputs, large_loss_count_floor: int, divergence_threshold: float,
) -> List[IllusionFinding]:
    """Runs every check and returns all findings -- callers must not cherry-
    pick which checks to report. A cohort is only interesting (per the
    standing directive) if a high WR coexists with a CLEAN result across
    every one of these, not merely the ones that happen to look good."""
    return [
        check_many_small_wins_few_unresolved_losses(inputs, large_loss_count_floor),
        check_closed_only_sample_excludes_losers(inputs, divergence_threshold),
        check_open_inventory_excluded_from_denominator(inputs),
        check_roll_loss_erasure(inputs),
        check_event_period_cherry_picking(inputs),
    ]


def any_illusion_confirmed(findings: Sequence[IllusionFinding]) -> Optional[bool]:
    """True if ANY check confirmed a detected illusion. None -- never
    False -- if every check is still unresolved (None), since "no illusion
    found" requires the checks to have actually run, not merely be
    unattempted."""
    resolved = [f.detected for f in findings if f.detected is not None]
    if not resolved:
        return None
    return any(resolved)
