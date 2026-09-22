# THETA Wave 2 Slice 18 -- quality correction on Slices 15-17

Status: this document corrects count and coverage claims made in this same
uncommitted worktree's Slices 15-17 research documents, in response to an
independent review that found a count discrepancy. `brokerAuthority: false`
throughout. `PRODUCTION_RUNTIME_CHANGED = NO`. `BROKER_MUTATIONS = 0`. No
git commands were run to produce this correction (per explicit instruction)
-- all findings below are from direct file reads in this worktree only.

## 1. What was wrong

An independent count of `src/research/pre-vps-capability-registry.ts` found
**33** `capabilityId` entries. Slice 15's reconciliation document and every
downstream Wave 2 document (the Slice 17 evidence matrix, the Slice 17
handoff, the correlation/severe-downside doc, the explicit audit-coverage
doc, and the defect-ledger addendum) claimed the registry held **27 or 28**
entries. This is a genuine count error, not a difference in what counts as
a "capability."

**Root cause:** `THETA_CAPABILITY_REGISTRY_RECONCILIATION_2026-09-22.md`
(Slice 15) stated the registry "held 22 capability records before this
pass" and that its five additions brought it "to 27 records." Both numbers
were wrong -- a direct count of the file's `capabilityId` occurrences
confirms **27** entries existed before Slice 15's five additions (not 22),
so Slice 15 actually brought the registry to **32** records (not 27). Slice
17 then added one more (`CORRELATION_WINDOW_STABILITY`), correctly computed
as "27 + 1 = 28" from the wrong Slice-15 baseline, when the correct
arithmetic is "32 + 1 = 33." Every later document that cited "28 entries"
inherited this same compounding error rather than independently recounting
the file.

## 2. What was NOT wrong

- **No `capabilityId` entries are missing from the registry file.** All six
  entries added across Slices 15 and 17 (`EVENT_RISK_STATE`,
  `OWNERSHIP_CONTRACT`, `CORRELATION_EVIDENCE`, `HAR_RV_CONTRACT`,
  `OPTIONOMICS_FEATURE_ENGINE`, `CORRELATION_WINDOW_STABILITY`) are present
  in `src/research/pre-vps-capability-registry.ts` with full field
  provenance.
- **No row is missing from `THETA_REQUIRED_VS_OPTIONAL_EVIDENCE_MATRIX_2026-09-22.md`'s
  table either.** All 33 capabilities, including all six new ones, were
  already listed as rows in that document's Section 1 table before this
  correction. Only the document's summary/total arithmetic (Section 0's
  "27 entries," Section 2's "Total: 28," and the tier-distribution counts
  that summed to 28 instead of the table's actual 33 rows) was wrong.
- **No classification, field, or finding in any Slice 15-17 document is
  retracted by this correction.** This is a counting/arithmetic correction
  only.

## 3. Corrected tier distribution (recounted directly against the 33 rows)

| Tier | Count |
| --- | --- |
| HARD_REQUIRED_SAFETY | 20 |
| REQUIRED_WHEN_APPLICABLE | 3 |
| ECONOMIC_RANKING_FEATURE | 4 |
| OPTIONAL_RESEARCH_MODIFIER | 3 |
| EMPIRICAL_FEATURE | 3 |
| **Total** | **33** |

`OPTIONOMICS_FEATURE_ENGINE` is counted under `ECONOMIC_RANKING_FEATURE`;
its pending-Codex-confirmation status (it may move to `HARD_REQUIRED_SAFETY`
depending on whether `options-chain-decision-intelligence.ts` is a live
Production path) is a qualifier on that one row, not a separate tally
bucket -- the original document's separate "(pending reclassification): 1"
row double-counted against a tier total that was already wrong.

## 4. Files corrected in place this pass

- `docs/research/THETA_CAPABILITY_REGISTRY_RECONCILIATION_2026-09-22.md` --
  baseline corrected 22 -> 27, post-Slice-15 total corrected 27 -> 32,
  coverage-count line and usage-census line corrected to match.
- `docs/research/THETA_REQUIRED_VS_OPTIONAL_EVIDENCE_MATRIX_2026-09-22.md` --
  Section 0/1 baseline corrected 27 -> 32, tier-distribution table
  recounted and corrected (28 -> 33 total, see Section 3 above), coverage
  disclosure corrected 27 -> 33.
- `docs/handoffs/THETA_WAVE_2_SLICE_17_HANDOFF_2026-09-22.md` -- registry
  total corrected 28 -> 33, method-usage-census fraction corrected "5+1 of
  28" -> "6 of 33," test-execution claim corrected (Section 5 below).
- `docs/research/THETA_CORRELATION_SEVERE_DOWNSIDE_TOOLING_2026-09-22.md` --
  registry total corrected 28 -> 33, test-execution claim corrected
  (Section 5 below).
- `docs/research/THETA_WAVE_2_EXPLICIT_AUDIT_COVERAGE_2026-09-22.md` --
  registry totals corrected (28 -> 33, "22 (now 23)" -> "27 (now 28)"
  pre-existing-entry counts), test-execution claim corrected (Section 5
  below).
- `docs/operations/THETA_CURRENT_DEFECT_GAP_LEDGER.md` -- Wave 2 Slice 17
  addendum's registry-count reference corrected, this correction's summary
  appended as a new addendum paragraph.
- `docs/research/THETA_ROUTER_INVALIDATION_ASSIGNMENT_TRACE_2026-09-22.md`
  and `docs/handoffs/THETA_R8_ROUTER_ASSIGNMENT_STRESS_HANDOFF_2026-09-22.md`
  -- flagged POSSIBLY SUPERSEDED (see Section 6).

## 5. Test-execution claims corrected

Slices 15 and 17's own documents stated `npm test` / `node --test` were
denied at the sandbox permission layer and that
`tests/correlation-window-stability.test.ts` was only verified by manual
trace, not execution. That was accurate for those earlier sessions. In this
correction pass, **`tests/correlation-window-stability.test.ts` was actually
run and passed 3/3.** The Slice 17 handoff, the correlation/severe-downside
document, and the explicit-audit-coverage document have each been updated
in place to state this correction and to make clear the original "could not
execute" / "denied" language describes only the earlier sessions, not the
current state. `npm` typecheck/lint/security checks for this worktree are
being run separately by Codex as part of the same review; this document
does not restate their results and does not claim them as passing or
failing.

## 6. Duplicate/superseded document flag (not resolved here)

The remote `claude/theta-management-challenger` branch has advanced two
commits beyond this worktree's base and reportedly already contains
canonical strategy-router / loss / assignment trace documents covering
substantially the same ground as this worktree's
`docs/research/THETA_ROUTER_INVALIDATION_ASSIGNMENT_TRACE_2026-09-22.md`
and its companion handoff,
`docs/handoffs/THETA_R8_ROUTER_ASSIGNMENT_STRESS_HANDOFF_2026-09-22.md`
(Slice 16). Per instruction, no git commands were run in this correction
pass, so the remote branch's actual content was not inspected here and this
document does not assert what it contains beyond what was reported. Both
local files have been marked "POSSIBLY SUPERSEDED" at their top, pointing
Codex/the user to reconcile against the remote branch's versions before
either is treated as canonical. Their underlying findings are not retracted
-- only their canonical status is in question until that reconciliation
happens.

## 7. Agent handoff

**OWNER:** Claude (quant research + adversarial validation)
**TASK:** Wave 2 Slice 18 -- quality correction on Slices 15-17's capability
registry count and coverage claims, and test-execution claims, following an
independent review.
**FILES CHANGED:** this document (new); six documents amended in place (see
Section 4); no source file under `src/`, `bots/theta/app/`, or `tests/` was
touched -- this pass corrected documentation only. `src/research/pre-vps-capability-registry.ts`
itself was read-only this pass (it was already correct; the bug was in the
documents describing it).
**KEY FINDING:** A count-baseline error introduced in Slice 15 (22 claimed
vs. 27 actual pre-existing entries) compounded through every downstream
Wave 2 document, producing a persistent "27/28 entries" claim against an
actual 33-entry registry. No registry entries, evidence-matrix rows, or
findings were actually missing -- this was a documentation arithmetic bug,
not a missing-work bug.
**VERIFICATION:** `tests/correlation-window-stability.test.ts` executed
this pass, 3/3 passing. `npm` typecheck/lint/security are being checked
separately by Codex.
**NEXT RECOMMENDED TASK:** Codex to (1) reconcile
`THETA_ROUTER_INVALIDATION_ASSIGNMENT_TRACE_2026-09-22.md` and its handoff
against the remote branch's canonical router/loss/assignment trace
documents and resolve or remove the local duplicates as appropriate: (2)
spot-check this correction's own arithmetic (Section 3's tier recount)
independently before relying on it; (3) continue prioritizing the two
standing highest-leverage blockers unchanged by this correction --
`CONTRACT_MULTIPLIER_MAPPING` root cause and the `ROLL_CC_CANDIDATE_SOURCE`
P0.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
