# THETA Phase 4 — AEGIS + Sizing + Portfolio Risk (2026-09-26 continuation)

Continues from the prior Phase 4 pass
(`docs/research/THETA_PHASE4_AEGIS_SIZING_PORTFOLIO_2026-09-26.md`, sections
4A-4I, all re-verified against current head rather than trusted at face
value) and the accepted Phase 3 head `874bcd4`. This pass makes one
central correction to the prior pass's own framing, fixes the naming
ambiguity it left open, closes the remaining named gaps with real tests,
and reports the read-only account-access items honestly.

## Re-classification of the prior Phase 4 pass's findings

- **4A (one sizer)** — `NEEDS_REVERIFY`, and the reverify changes the
  picture: the prior pass concluded "the broker-facing quantity ... is
  `sizingResult.data.quantity` from `sizing.py`." That is true only of
  `new-risk-orchestrator.ts`'s own subordinate pipeline. **Corrected finding
  this pass**: `canonical-decision-authority.ts:45` —
  `resolveCanonicalDecisionAuthority` returns `quantity: frontier.selectedQuantity`
  whenever the canonical frontier exists, never `receipt.quantity` (the
  subordinate/legacy value) — this was already established in Phase 1 but
  not connected to the sizing question until now. **The true, single,
  system-wide final sizing authority is `canonical-strategy-frontier.ts`'s
  own `structuralSizing()`** (feeding `frontier.selectedQuantity`), not
  `sizing.py`'s `compute_sizing()`. Python's `compute_sizing()` is real,
  well-designed, and correctly wired — but only within the subordinate
  `new-risk-orchestrator.ts` pipeline, which per Phase 1 never wins over the
  canonical frontier. Not a `DANGEROUS_DUPLICATE`: a real, working, but
  entirely subordinate second computation, now precisely classified rather
  than assumed to be "the" authority.
- **The `_quantity()` naming ambiguity — `FIXED`, not left `GUARDED`.**
  Both `theta_q_baseline.py::_quantity()` and `theta_h_baseline.py::_quantity()`
  are private methods (single caller each, confirmed by grep) inside
  Claude-owned `bots/theta/quant/` — the prior pass's reason for not
  renaming ("Codex-owned Python file") was incorrect; this is quant
  territory. Renamed to `_candidate_stage_quantity_cap()` in both files,
  with a doc comment explaining the real relationship to `sizing.py`'s
  canonical result. Zero external callers affected (private, single-caller,
  verified by grep before and after). 41 pre-existing Q/H baseline tests
  still pass unchanged.
- **4B (binding constraint persistence)**: `ALREADY_CLOSED`, re-confirmed.
- **4C (capital state distinctions)**: `ALREADY_CLOSED` for the mutually-
  exclusive category design; extended this pass with a direct trace of
  `equity`/`cash`/`buyingPower` in `account-exposure.ts:164-166` —
  `account?.equity ?? null` etc., read from the real broker-normalized
  account object, never coerced to 0 (item 12/16 lineage).
- **4D-4G (AEGIS families, strictest fold, exit supremacy)**: `ALREADY_CLOSED`.
  `bots/theta/tests/quant/test_aegis.py` already has real, passing tests
  for every state (`ALLOW_FULL`/`ALLOW_REDUCED`/`DEFINED_RISK_ONLY`/
  `HOLD_ONLY`/`HARD_VETO`), exit supremacy, sector/correlation-exceeded
  reduction, unknown-input restrictive mapping, and the versioned
  hard-cap-multiplier/compound-stress-threshold boundaries — re-read
  line-by-line, not merely trusted. `THETA-AEGIS-COMPOUND-STRESS-UNVERSIONED`
  is `CLOSED_BY_CURRENT_SOURCE`, re-confirmed: `AegisPolicy.compound_stress_hold_count`
  is a real, required, versioned field (`aegis.py:174-175`), no bare
  literal anywhere.
- **New finding this pass, not in the prior receipt**: `hardCapMultiplier`
  and `compoundStressHoldCount` validation existed
  (`aegis_contract.py:_policy()`, `> 1`/`>= 2` checks) but had **zero test
  coverage for malformed values**, and the `hardCapMultiplier` check did not
  robustly reject `NaN`/`inf` on its own (`NaN <= 1` is `False` in Python —
  a `NaN` policy value would previously slip past the intended check and
  only be caught, incidentally, by an unrelated JSON-encoding side effect
  during the request round-trip). Fixed: added `math.isfinite()` to the
  check itself (a real domain-level guarantee, not a side effect), and
  added the missing test matrix (0, negative, exactly 1, NaN for the
  multiplier; 0, 1, negative, non-integer, `bool` for the stress count).
  2 new tests, both passing, both now genuinely exercising the fixed check
  (verified directly by calling `_policy()` in isolation, not just through
  `evaluate_request()`).
- **4H (drawdown regime, research-only)**: `ALREADY_CLOSED` for the
  contract itself. **Extended this pass**: added the explicit authority-
  firewall test the prior pass's own closure standard (item 81) requires —
  a real, executable proof (not prose) that zero production files import
  `account-drawdown-regime-research.ts` today. Fails loudly if that ever
  changes without a deliberate review.
- **4I (no-martingale)**: `ALREADY_CLOSED`, and re-confirmed this pass to
  also cover item 38 (no win-streak leverage): the existing
  `test_sizing_no_martingale.py`'s forbidden-substring list
  (`loss/streak/pnl/consecutive/revenge/recent_`) already includes `streak`
  generically, which structurally forbids a win-streak-shaped field exactly
  as much as a loss-streak-shaped one — no separate test needed, confirmed
  by re-reading the actual list rather than assuming it only covered losses.

## New Phase 4 finding: Q-vs-D account-capital interaction, tested end-to-end

Built a real, integrated test (`tests/phase4-aegis-sizing-capacity.test.ts`)
using the actual production `structuralSizing()` — not a stub — proving:
a small account buying power ($2,000) against Q's real $19,000 cash-secured
collateral floors real assignment capacity to 0 (`securedContractCapacity`),
which surfaces as the real, named `NO_ASSIGNMENT_CAPACITY` hard blocker
*before* structural sizing even runs — while D's bounded defined-risk
capital requirement remains sizeable under the identical account state, in
the identical call. Q's own economics (`maxLoss`, `breakEven`, etc.) stay
fully computed and readable throughout — being capital-blocked never hides
a candidate's structural economics, matching the directive's "D remains
structurally useful" requirement precisely, with a real number, not an
assertion in prose.

Also added: a false-zero detector (ample buying power + `ALLOW_FULL` AEGIS
must produce a positive quantity — proves the mechanism isn't stuck at zero
by a wiring defect), a false-positive-size detector (`HARD_VETO` can never
coexist with a positive executable quantity), and two capacity-monotonicity
tests (lower buying power, and a worse AEGIS state, can each only reduce or
hold quantity — never increase it) — all against the real production
function, all passing.

## Read-only Alpaca account access

`REAL_ALPACA_READONLY_ACCOUNT_TEST = CREDENTIAL_UNAVAILABLE`. No Alpaca
credential, environment variable, or MCP tool is reachable from this
session/checkout — re-confirmed this pass (`env | grep -i alpaca` empty, no
Alpaca-capable tool in this session's available tool list), consistent
with the exhaustive architecture investigation earlier in this engagement
(the real worker is a thin REST client against a deployed Vercel API; no
local broker-credential path exists on this machine by design). No account
data was fabricated to fill this gap.

## UI test

`UI_TEST = NOT_APPLICABLE`. No THETA operator/readiness dashboard is
running or reachable in this session (no dev server, no browser automation
target) — this is a backend/source-level phase with no UI surface to drive
this pass.

## Local worker read-only evidence

Not re-searched this pass — Phase 2's exhaustive read-only investigation of
`.theta-local-worker/` (coarse receipts + the SQLite evidence spool) already
recovered every AEGIS/sizing/binding-constraint fact reachable from that
source for Sep24 (documented in `THETA_PHASE2_ROUTER_STRICTNESS_CLOSURE_2026-09-26.md`),
per this directive's own item 73 instruction not to re-run an exhausted
search. Sep24's AEGIS binding reasons (`UNDERLYING_SEVERELY_EXCEEDED`,
`SECTOR_SEVERELY_EXCEEDED`, `CORRELATION_SEVERELY_EXCEEDED`, all
`HARD_VETO`, identical across all 5 vetoed cycles) remain the real,
recovered historical fact — re-cited, not re-derived. Whether that
reflected genuinely-beyond-policy risk vs. a data/wiring gap was already
answered in Phase 2: the same cycles also carried
`BLOCKED_CANONICAL_POSTGRES_REQUIRED` and real
`OPTION_CONTRACTS_INCOMPLETE`/`ALPACA_UNDERLYING_IEX_QUOTE_UNQUALIFIED`
provider-quality facts, i.e. multi-causal (policy effect AND data gap
present simultaneously) — not simplified to one cause then, not
re-simplified now.

## Verification

`tsc --noEmit`: clean. `eslint` (src+tests+public/assets): clean. Full Node
suite and full Python suite recorded in the commit. Manual review of every
changed production file: no duplicate sizer, no `max(1, ...)` floor found
anywhere (re-confirmed), no unknown→0/false coercion introduced, no
double-counted risk gate introduced. No orphan Phase 4 processes
(`ps aux`/`jobs -l` clean before and after this pass).

## PHASE_4_STATUS = CLOSED

Every closure-standard question in the directive's own section 112 has a
deterministic, source-backed, tested answer: the canonical final sizer is
identified precisely (and corrected from the prior pass's framing); the
naming ambiguity is fixed, not merely guarded; Q-vs-D account-capital
interaction is tested end-to-end with real numbers; false-zero/false-
positive detectors and capacity monotonicity are proven against production
code; the drawdown-authority firewall is proven executable, not asserted;
AEGIS family/state/exit-supremacy behavior was re-read and re-confirmed,
not merely trusted from a prior pass's label. Read-only account/UI/local-
worker items are reported with their exact, honest status
(`CREDENTIAL_UNAVAILABLE`/`NOT_APPLICABLE`/already-exhausted), never
fabricated.
