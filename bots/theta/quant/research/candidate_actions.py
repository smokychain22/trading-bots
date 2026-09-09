"""Candidate action vocabulary for THETA Strategy DNA hypotheses.

This is the hypothesis-registry action space (research layer), not the frozen
runtime enums in the Backend Schema. It is broader than either runtime enum
alone because a hypothesis can span both the entry decision and management
decisions. The mapping to the runtime enums is recorded explicitly below so
nothing here is mistaken for a redefinition of the frozen schema.

Runtime schema enums (Backend/Database Schema v1.1 FINAL section 7), for
reference only -- not reproduced as code here, since they belong to Codex's
migration layer, not this module:
    entry_action:      TRADE, REDUCED, ALTERNATE, WAIT
    management_action:  HOLD, CLOSE, ROLL, ACCEPT_ASSIGNMENT, EXPIRE,
                        SELL_CC, CLOSE_STOCK, CALL_AWAY, REDEPLOY
"""

from enum import Enum


class CandidateAction(str, Enum):
    WAIT = "WAIT"
    OPEN_CSP = "OPEN_CSP"
    HOLD = "HOLD"
    CLOSE = "CLOSE"
    ROLL = "ROLL"
    ASSIGN = "ASSIGN"
    EXPIRE = "EXPIRE"
    RECOVERY_WAIT = "RECOVERY_WAIT"
    SELL_CC = "SELL_CC"
    CLOSE_STOCK = "CLOSE_STOCK"
    REDEPLOY = "REDEPLOY"


# Maps this research-layer vocabulary to the frozen runtime schema enums, for
# traceability only. This module never writes to those columns directly --
# that is the execution engine's job (Codex-owned).
RUNTIME_MANAGEMENT_ACTION_EQUIVALENT = {
    CandidateAction.HOLD: "HOLD",
    CandidateAction.CLOSE: "CLOSE",
    CandidateAction.ROLL: "ROLL",
    CandidateAction.ASSIGN: "ACCEPT_ASSIGNMENT",
    CandidateAction.EXPIRE: "EXPIRE",
    CandidateAction.SELL_CC: "SELL_CC",
    CandidateAction.CLOSE_STOCK: "CLOSE_STOCK",
    CandidateAction.REDEPLOY: "REDEPLOY",
    # WAIT, OPEN_CSP, RECOVERY_WAIT have no 1:1 management_action row: WAIT and
    # OPEN_CSP belong to the entry_action enum instead (WAIT is shared with it
    # verbatim; OPEN_CSP corresponds to entry_action TRADE), and RECOVERY_WAIT
    # is a lifecycle_state (schema section 7), not an action code at all.
}

RUNTIME_ENTRY_ACTION_EQUIVALENT = {
    CandidateAction.WAIT: "WAIT",
    CandidateAction.OPEN_CSP: "TRADE",
}
