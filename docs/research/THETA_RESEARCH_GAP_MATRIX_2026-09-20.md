# THETA research gap matrix, 2026-09-20

Snapshot after the P1-P5 Claude research wave (branch `claude/theta-management-challenger`,
head commit noted in the accompanying receipt) synced against canonical main. This is a
STATUS matrix per capability, using the exact seven-value taxonomy the owning directive
requested. It complements, and does not replace, the existing subsystem-level
`THETA_GITHUB_GAP_MATRIX.md` (2026-09-11 baseline) -- that document maps subsystems to
external reference repos; this one reports what state each capability is actually in
right now, honestly, with no vague "still needs work" entries.

Status values used below:
`COMPLETE` | `RESEARCH_TOOLING_COMPLETE` | `EMPIRICAL_EVIDENCE_BLOCKED` |
`PROVIDER_BLOCKED` | `PERMISSION_BLOCKED` | `EXTERNAL_ACCOUNT_BLOCKED` |
`LIVE_AUTH_BLOCKED`

| Capability | Status | Note |
|---|---|---|
| Runtime autonomy | COMPLETE | Codex-owned; scheduler/worker/champion running (Paper champion `4abeb11b`). Not touched by this research branch. |
| Broker reconciliation | RESEARCH_TOOLING_COMPLETE | `zero-trade-diagnostic.ts` (Codex) provides cycle-level execution-handoff visibility (action plans -> order intents -> broker orders -> fills). Full reconciliation-failure-mode coverage remains Codex's roadmap item per `THETA_GITHUB_GAP_MATRIX.md`. |
| Execution | EMPIRICAL_EVIDENCE_BLOCKED | Zero broker submissions in the inspected 13-cycle sample (0 quantity, 0 order intents) -- blocked upstream by the ownership/AEGIS bootstrap deadlock, not by execution code itself. |
| Order lifecycle | RESEARCH_TOOLING_COMPLETE | Canonical lifecycle enum (`ledger-contract.ts`) and R6 outcome labels fully cover the modeled states; zero resolved real orders exist yet to validate against. |
| Strategy routing | COMPLETE | `strategy-package.ts`'s 5-branch router (`THETA_CONVENTIONAL`/`THETA_HOLD_STRIKE`/`THETA_RECOVERY`/`THETA_CC`/`THETA_DEFINED_RISK`) is canonical and stable; this wave added no routing changes (by design -- one-brain rule). |
| Contract selection | COMPLETE | `canonical-strategy-frontier.ts` remains the sole live candidate-ranking authority; confirmed unmodified and un-duplicated by every module built this wave. |
| Ownership evidence | EMPIRICAL_EVIDENCE_BLOCKED | Codex's bootstrap audit (`THETA_OWNERSHIP_AEGIS_BOOTSTRAP_AUDIT_2026-09-19.md`) proves `RecoveryQuality` requires prior recovery history the account does not have -- a genuine cold-start deadlock, not a code defect. This wave's `evidence-completeness-diagnostic.ts` makes the gap measurable (per-component/per-symbol/per-cycle known/unknown counts) but does not and cannot resolve it -- that requires a versioned cold-start policy decision Codex/the owner must make. |
| AEGIS | PROVIDER_BLOCKED | Deterministic fixtures prove AEGIS itself is implementation-correct (`ALLOW_FULL` when fully known, `HOLD_ONLY` when one family is unknown). The blocker is several risk-family inputs (sector concentration, correlation-cluster exposure, inventory/assignment/recovery capacity, IV-shock/spread-widening state) that have no real data source wired yet -- a provider/data-completeness gap, not an AEGIS defect. |
| Sizing | RESEARCH_TOOLING_COMPLETE | `sizing.py`/`account-exposure.ts` structural sizing is canonical and correctly returns quantity zero rather than fabricating a trade when upstream evidence is UNKNOWN -- exactly the designed-safe behavior, confirmed by the audit's own root-cause classification. |
| Quote quality | RESEARCH_TOOLING_COMPLETE | `zero-trade-diagnostic.ts`'s `quoteUsableEconomics` (Codex) + this wave's `quote-quality-cohort.ts` (Claude) together cover overall distributions and versioned cohort breakdowns/near-miss analysis. No profitability claim made; near-miss counts are explicitly not "missed profit." |
| Conventional | COMPLETE | Live, SHADOW-executable, the only branch that has ever produced a real Master Paper candidate path. |
| Recovery | RESEARCH_TOOLING_COMPLETE | This wave's `recovery-covered-call-cohort.ts` (P4) built the cohort/dedup/independent-N tooling; `RECOVERY_COHORT_STATUS` remains blocked on real resolved chains (currently zero). |
| Covered Call / Call-Away | RESEARCH_TOOLING_COMPLETE | Same module as Recovery; call-away folded into the CC action breakdown per the minimum-coherent-structure directive. Blocked on the same zero-resolved-chain sample. |
| Hold-Strike | RESEARCH_TOOLING_COMPLETE | P3's `hold-strike-empirical-cohort.ts` (Codex-reviewed and corrected) covers candidate observation + cohort + Conventional pairing. `THETA_HOLD_STRIKE` remains `RESEARCH_ONLY`; no applicability authority was recreated (321b29b stays rejected). |
| Defined-Risk | RESEARCH_TOOLING_COMPLETE | P1's `defined-risk-economics.ts` (Codex-reviewed) plus this wave's P5E `defined-risk-vs-csp-economics.ts` close the previously-open `DEFINED_RISK_VS_CSP_STATUS = NOT_STARTED` gap. `THETA_DEFINED_RISK` remains `RESEARCH_ONLY`. |
| Whole-chain accounting | COMPLETE | `whole-chain-economics.ts` (`computeWholeChainPnl`/`computeEffectiveStockBasis`) is canonical, Codex-owned, and reused verbatim by every research module built this wave -- never re-derived. |
| PIT datasets | COMPLETE | `point-in-time-evidence.ts`'s `CandidatePointInTimeEvidence`/Postgres store is canonical; every new module this wave enforces its own PIT ordering checks against caller-supplied timestamps rather than depending on this store directly. |
| R6 labels | COMPLETE | `r6-outcome-labels.ts` (`R6OutcomeLabelSet`) is canonical and unmodified this wave; consumed read-only by P3/P4/P5A. |
| R8 analytics | COMPLETE | Confirmed present (`r8-performance-analytics.ts`), not touched this wave (no gap identified requiring it). |
| Management counterfactuals | COMPLETE | `management-counterfactual-analysis.ts`/`management-counterfactual-cohort.ts` (Codex-hardened) are canonical; this wave's P4 `buildLifecycleManagementCounterfactualInput` is a pure structural adapter onto them, adding zero validation logic of its own. |
| Portfolio/capital analytics | COMPLETE | `portfolio-capital-analytics.ts` (P2, Codex-reviewed and corrected: `researchUncommittedEquityEstimate`/`knownCapitalToEquityRatio` naming, `capitalAccountingState`, active-chain duplicate protection) is canonical. No further work identified this wave -- confirmed `ALREADY_COMPLETE` rather than rebuilt. |
| Volatility research | COMPLETE | `volatility-risk-premium.ts`, `volatility-acceleration.ts`, HAR-RV bridge all canonical from earlier waves; no duplicate feature was created this wave. |
| Professional method corpus | RESEARCH_TOOLING_COMPLETE | This wave added two gap-driven, source-graded records (`DNA-COLD-01`/`DNA-COLD-02` in `THETA_DYNAMIC_MANAGEMENT_AND_STRATEGY_SWITCHING.md`) targeting the confirmed cold-start bootstrap gap specifically -- both `STATUS = REFERENCE`, no runtime change, one explicitly flagged `EVIDENCE_LEVEL = LOW-MEDIUM` pending a full paper read. |
| GitHub ledger | COMPLETE | `THETA_GITHUB_GAP_MATRIX.md`/`GITHUB_REPO_RESEARCH_LEDGER.md` reviewed this wave; no new repo search was performed because no capability gap this wave required one outside an already-covered reference family (per the standing "no search without a concrete gap" rule). |
| Always-on hosting | Not assessed this wave (Codex infrastructure, out of research scope). |
| Follower validation | PERMISSION_BLOCKED | `FOLLOWER_EXECUTION = LOCKED` per every standing directive; orders remain locked pending explicit owner authorization, unrelated to any code defect. |
| Live-small | LIVE_AUTH_BLOCKED | `LIVE_MONEY_AUTHORIZED = NO` per every standing directive; no live authorization has been requested or granted. |

## What this matrix is not

It is not a claim of profitability, edge, or readiness to graduate any strategy branch.
Every `RESEARCH_TOOLING_COMPLETE` entry above means the DESCRIPTIVE/DIAGNOSTIC machinery
exists and is tested against synthetic fixtures (which validate math/types/UNKNOWN
handling only, never profitability, per the standing rule) -- the underlying
`independentN`/`resolvedChainCount` for every cohort module built this wave is currently
**zero** for real chains. `EMPIRICAL_EVIDENCE_BLOCKED` entries above are the honest,
correct classification for that state; they are not `COMPLETE`.
