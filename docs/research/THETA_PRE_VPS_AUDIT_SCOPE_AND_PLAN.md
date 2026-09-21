# THETA pre-VPS audit -- scope and phased plan

The pre-VPS directive asks for 25 major sections: a machine-readable
capability registry, a rebuilt unknown ledger, a provider capability matrix,
a required-vs-optional evidence matrix, a strategy-router truth audit, full
entry and management end-to-end graphs, complete profit/loss/assignment/
recovery/CC/call-away audits, a canonical authority map, a static false-safe
scan, Optionomics field re-qualification, canonical export consumers,
correlation/severe-downside tooling, a metric catalog, data-sufficiency and
model-governance documents, a brain capability matrix, a pre-VPS acceptance
contract, and a Codex integration backlog -- each requiring genuine,
source-grounded tracing across a two-agent, multi-hundred-file codebase.

Attempting all 25 in a single pass would force a choice between (a) fabricating
or extrapolating findings to look complete, or (b) producing real findings for
a fraction of the surface while silently implying full coverage. Both violate
the directive's own governing principle: **"DO NOT MAKE THETA LOOK READY. MAKE
THETA ACTUALLY READY."** A false `ZERO_AVOIDABLE_UNKNOWN_READY = YES` or
`BOT_BRAIN_READY_FOR_FIRST_PAPER = YES` would be exactly the kind of "looks
ready" outcome the owner is explicitly guarding against.

This pass (Slice 1) therefore completed the highest-leverage, most
mechanically groundable pieces -- the ones that (a) can be verified against
real source and a real live-session forensic rather than speculation, and (b)
feed directly into most of the remaining sections:

## Completed this pass

- Merged current `origin/main` (`b1186f0`), verified clean (tsc/tests green), preserved all existing research commits.
- `THETA_PRE_VPS_UNKNOWN_LEDGER.md` -- 4 concrete, source-grounded unknown-register entries (3 confirmed avoidable, 1 high-priority undetermined) plus a companion false-safe/false-risk static scan of `src/theta/`/`src/execution/` (Production-critical paths).
- `THETA_CANONICAL_AUTHORITY_MAP.md` -- confirms exactly one real, reachable management authority; confirms the second array-based management architecture remains quarantined (zero real callers); confirms the cross-branch Pareto gap in `canonical-strategy-frontier.ts` is unchanged.
- `THETA_CODEX_PRE_VPS_INTEGRATION_BACKLOG.md` -- 2 P0 items, 3 P1 items, with exact file:line, required fix, and required tests.
- Grounded every finding in either a direct source read this pass or the real `docs/operations/THETA_R7_LIVE_SESSION_FORENSIC_2026-09-21.md` live-session forensic (a genuine Aiven/Alpaca-derived document, not a simulation) -- notably, that forensic already answers a large share of directive items 21/22/24's spirit (what does "ready" actually mean, does THETA reach a real decision end to end) more authoritatively than a fresh code-only trace could, since it reflects an actual attempted live cycle.

## Explicitly deferred (not started this pass)

Given the volume, grouping by the directive's own slice boundaries:

- **Capability registry + provider capability matrix** (items 1, 3): requires a full inventory across ~20+ capability domains with real producer/consumer verification for each -- a multi-session effort on its own.
- **Required-vs-optional evidence matrix** (item 5): requires tracing every entry/management feature's actual runtime gating behavior, not just AEGIS.
- **Strategy-router truth audit** (item 6): requires a full `strategy-timing-router.ts` trace (not yet read this pass) to give a defensible `STRATEGY_SWITCHING_ECONOMIC` vs. `STRUCTURAL_ONLY` verdict -- flagged as the natural next step in the authority map.
- **Full entry/management E2E graphs** (items 7, 8): the R7 forensic gives strong real evidence for large parts of the entry graph, but a formal arrow-by-arrow `REAL/WIRED/REACHABLE/PERSISTED/TESTED` table was not built this pass.
- **Profit/loss/assignment/recovery/CC/call-away completeness audits** (items 9-11): not started.
- **Optionomics field re-qualification, canonical export consumers, correlation/severe-downside tooling, metric catalog, data-sufficiency, model governance, brain capability matrix, acceptance contract** (items 14-21): not started this pass; several of these were already scoped/deferred in the prior Slice C/D directive and remain open.

## Recommended next slice

Given P0-2 (the `CONTRACT_NOT_EXECUTABLE` root cause) is the single highest-leverage
open item -- it directly explains the gap between "thousands of real
candidates evaluated" and "zero trades" in the only real session evidence
available -- the recommended next action is for **Codex** (who has real Alpaca
access this research branch does not) to resolve P0-2 before further research
slices are prioritized. In parallel, the next Claude-owned research slice
should be the `strategy-timing-router.ts` trace (closes the open question in
`THETA_CANONICAL_AUTHORITY_MAP.md`) and/or the entry E2E graph, since both are
now scoped precisely rather than attempted broadly.
