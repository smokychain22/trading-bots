# THETA canonical frontier / H-D shadow generator reconciliation

Wave 6 correction. Source: `docs/operations/THETA_RESOLVED_AND_ACTIVE_WORK.md`
(`ACTIVE_IMPLEMENTATION` item 5, merged from main `2a50ad6`), independently
verified by reading `src/theta/canonical-strategy-frontier.ts` (lines
260-520) and `src/theta/theta-shadow-cycle.ts` (lines 770-860) directly.

## The correction

Across several Wave 5 research documents (listed below) I repeated the
claim: **"no code path anywhere in the live pipeline constructs a multi-leg
Defined-Risk spread candidate or a distinct short-DTE Hold-Strike
lattice."** This claim is **incomplete and, as stated, wrong**.

`canonical-strategy-frontier.ts` contains real, structurally complete
candidate-construction logic for both branches:

- `singleLegPutCandidate(branch, ...)` -- called for both
  `THETA_CONVENTIONAL` and `THETA_HOLD_STRIKE`. Builds a real single-leg CSP
  candidate.
- `definedRiskCandidate(...)` -- a real multi-leg spread builder with
  genuine structural validation (`INVALID_SPREAD_WIDTH`,
  `MISMATCHED_EXPIRATION`, `MISMATCHED_MULTIPLIER`,
  `MULTI_LEG_PRICE_UNKNOWN`, `NON_POSITIVE_NET_CREDIT`), bounded by
  `maxDefinedRiskStructuresPerCycle` / `DEFINED_RISK_ENUMERATION_BOUND_REACHED`.
- `buildBranch(...)` -- filters the same fetched `input.contracts` array by
  each branch's own real registry DTE lattice (`source.lattice.dteMin/dteMax`)
  before invoking the branch-specific candidate builder above.

So the construction *logic* exists in the live source tree today, is
branch-aware, and is exercised by `canonical-strategy-frontier.ts`'s own
tests.

## What remains genuinely unresolved (not settled by this correction)

`theta-shadow-cycle.ts`'s real chain fetch (`fetchOptionContracts(config.alpaca,
{expirationDateGte: config.optionExpirationDateGte, expirationDateLte:
config.optionExpirationDateLte, ...})`) pulls a **single configured
expiration window per cycle**, not one window per branch. Whether that
configured window is ever wide enough in practice to contain real
Hold-Strike-lattice (2-5 DTE) or Defined-Risk-lattice (7-60 DTE) contracts
*distinct from* THETA_Q's own conventional window depends entirely on the
real runtime value of `config.optionExpirationDateGte/Lte`. That value was
**not read in this pass** -- this is a config/runtime-reachability question,
not a construction-logic question, and it is Codex's (engineering) side of
`bots/theta/app/` to confirm, not something this research pass can settle by
re-reading TypeScript source alone.

`RUNTIME_REACHABLE` (does `buildBranch` ever actually receive H/D-lattice
contracts in a real cycle) is therefore still **UNKNOWN**, distinct from
`CAN_REPRESENT` (proven true: the code can construct these candidates when
given the right input).

`canonical-strategy-frontier.ts` itself is a real, downstream diagnostic/
export artifact, called after `new-risk-orchestrator.ts`'s real decision
path -- not a competing live decision authority. This does not change: only
`thetaQEligible` drives the real control flow in `new-risk-orchestrator.ts`
today.

## Disposition of the two Wave 5 shadow-generator modules

Per Codex's explicit instruction, `hold-strike-shadow-candidate-generator.ts`
and `defined-risk-shadow-candidate-generator.ts` are **research prototypes to
reconcile with the existing frontier, not competing/duplicate Production
decision authorities**. They remain `brokerAuthority: false` research code.
Codex additionally identified two real defects, both fixed in this pass:

1. **Hold-Strike generator**: lacked complete contract-identity validation.
   Fixed -- `EMPTY_CONTRACT_ID` and `DUPLICATE_CONTRACT_ID` rejection reasons
   added; a duplicate `contractId` within one chain snapshot now rejects
   *both* (all) occurrences rather than silently keeping one. Covered by
   3 new tests in `tests/hold-strike-shadow-candidate-generator.test.ts`.
2. **Defined-Risk generator**: could label a structurally valid but stale/
   desynchronized quote pair as `accepted` with no caller control. Fixed --
   added required field `requireSynchronizedFreshQuotes: boolean`; when
   `true`, a pair whose `quoteState !== 'BOTH_FRESH_AND_SYNCHRONIZED'` is
   rejected as `QUOTE_NOT_SYNCHRONIZED_FRESH` instead of accepted. When
   `false`, the prior behavior (accept, but preserve the real `quoteState`
   evidence) is retained -- this module still never hides desynchronization,
   it now also lets a stricter caller refuse it outright. Covered by 2 new
   tests in `tests/defined-risk-shadow-candidate-generator.test.ts`.

## Documents requiring a correction note (propagated alongside this file)

- `docs/research/THETA_ECONOMIC_AUTHORITY_DEEP_TRACE.md`
- `docs/research/THETA_STRATEGY_ROUTER_TRUTH_MATRIX.md`
- `docs/research/THETA_ENTRY_END_TO_END_GRAPH.md`
- `docs/research/THETA_CODEX_PRE_VPS_INTEGRATION_BACKLOG.md`
- `docs/research/THETA_BRAIN_CAPABILITY_MATRIX.md`

Each gets a short, dated correction note pointing back to this file rather
than a full rewrite -- the underlying finding in each (that H/D candidates
are not proven `RUNTIME_REACHABLE` / `PAPER_AUTHORIZED`, and that only
THETA_Q drives the real control flow via `thetaQEligible`) remains correct;
only the narrower claim "no construction code path exists at all" is
withdrawn.
