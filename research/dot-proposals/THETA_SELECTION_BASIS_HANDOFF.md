# Public source-only selection audit

Private single-episode details have been removed. No new program execution or test count is claimed.

# What actually selects Q, and what its economics mean

Frozen source: `d0b479f3dfd0a6d9a1e79a699308cab09ed9f1ba`. Read-only source trace; no program execution, account/runtime access, new tests, source changes or publication. Exact downloaded file hashes are retained in a separate source manifest; the cited public commit and paths identify the reviewed source.

## Direct answer

**An eligible low-delta Q candidate can be selected without calibrated EV under the explicit Paper-bootstrap path.** EV remains UNKNOWN; the bootstrap is an eligibility exception, not an invented positive value. Final candidate ordering first uses known EV-backed return per capital-day; when absent/tied in the inspected default/SHADOW path, it falls back to candidate-ID order. With standard same-root OCC IDs, expiry and strike ordering can therefore decide between otherwise qualified contracts. This is transparent deterministic selection, not demonstrated alpha.

A repository author comment about a particular choice is not independent historical evidence. Any actual selection still needs the sealed candidate set, deployed source, bootstrap evidence, decision receipt, rank mode, rejection trace and fill lineage.

## Exact pipeline and evidence roles

| Stage | Source at frozen commit | Selection role and limits |
|---|---|---|
| Underlying shortlist | `src/theta/universe-policy.ts:204–240`; `theta-shadow-cycle.ts:834–843` | Eligible underlyings ranked by average dollar volume descending, explicitly a v1 placeholder rather than economic alpha. Chosen underlying precedes option ranking; this matters for unobserved opportunities. |
| Q lattice/evaluation | `bots/theta/quant/models/theta_q_baseline.py:235–315,375–452` | Ownership score=ownability×(1−severe-drawdown probability) when both known; IV rank informational. Feasible candidates initially ordered by ownership score. `ownership_v0.py:1–14,51–61` marks its multiplicative decomposition/formulas TEST hypotheses. Labels such as EMPIRICAL_OWNERSHIP do not themselves prove fitted/OOS calibration. |
| Missing EV | `theta_q_baseline.py:291–315`; `new-risk-orchestrator.ts:850–866` | Baseline sets ev_net=None explicitly. EV-backed returnPerCapitalDay remains null, not maximum credit divided by capital-days. Gross premium and costs are separately reported. |
| Explicit bootstrap | `theta_q_baseline.py:375–430`; `paper-entry-bootstrap.ts`; `opportunity_frontier.py:117–197` | Versioned, reason-coded bounded Paper eligibility permits missing ownership components/EV only within its allowed evidence path. Without bootstrap, missing required ownership/EV is non-actionable PASS/UNKNOWN_INPUT. Known adverse/event/risk/execution conditions retain their separate gates. Bootstrap eligibility does not grant broker authority. |
| Economic Pareto filter | `bots/theta/quant/models/pareto_frontier.py:66–136`; `new-risk-orchestrator.ts:830–892` | Keeps nondominated candidates; not a winner selector. Gross credit is reporting-only. UNKNOWN pairwise dimensions are skipped, so known capital-days/spread can still drive dominance when EV/tail outcomes are missing. This is partial-information dominance, not proof of total economic inferiority. |
| Opportunity book | `opportunity_frontier.py:117–197,226–264` | Classifies OPEN/WAIT/PASS from upstream eligibility, risk and context; orders by known EV-backed return/capital-day, unknown last. Unknown EV bootstrap cases remain explicitly labeled. |
| Account/execution eligibility | `new-risk-orchestrator.ts:1014–1093` | Account-aware sizing, candidate AEGIS and executable-price checks precede final opening selection; missing empirical utility can be explicitly marked PAPER_BOOTSTRAP_UNCALIBRATED rather than fabricated. Final quantity must be positive; broker authority still separate. |
| Actual Q decision receipt | `src/theta/decision-assembly.ts:304–317,346–397` | Opening candidates require positive EV+RPCD OR explicit bootstrap, executable contract, permitted AEGIS, positive sizing and SUBMIT recommendation. Sort is known RPCD descending then candidate ID, unless an ENFORCED economic order reaches this function. It records bootstrap selected / EV unavailable. No execution authorized by this receipt. |
| Economic shadow adapter | `new-risk-orchestrator.ts:1097–1102`; `strategy-economics.ts:606–635` | Inspected orchestrator supplies policy=null, opening cost=null and no enforcement certification. Adapter downgrades requested ENFORCED to SHADOW unless risk bounds and owner-approved validation evidence both exist. It records alternate economic winner/divergence but does not replace default Q choice here. This is source-path behavior, not a claim of deployed configuration. |
| Canonical frontier binding | `canonical-strategy-frontier.ts:1310–1359`; `canonical-decision-authority.ts:20–54` | Canonical frontier verifies decision snapshot/time, candidate branch/identity, positive size and authority. Bound Q decision determines entry candidate; structural order cannot override it. If no decision is supplied, structural-only Q selection is labeled STRUCTURAL_RESEARCH_ONLY. Canonical authority refuses fallback to subordinate receipt when frontier absent. |

## Two distinct meanings of “return per capital-day”

1. **Q decision path**: `new-risk-orchestrator.ts:850–854` calculates evNet/(securedCollateral×DTE), so it is null until EV exists. This is the quantity sorted first in final decision assembly.
2. **Strategy economic shadow**: `strategy-economics.ts:156–196` uses maximum net credit if known, otherwise gross credit with explicit COSTS_UNKNOWN provenance, divided by capital and DTE. This is a maximum-profit/carry scenario, not expected return. `expectedValueUsd` remains UNKNOWN at`:257`.

Annualized shadow ROC is simple365/DTE scaling and explicitly excluded from ranking. It is not a realizable compounded annual return. Absolute delta is labeled a risk-neutral ITM proxy, not probability of profit. Stress losses are expiry-intrinsic package losses at configured gap and implied−2σ/−3σ points, not calibrated CVaR, expected shortfall, close-out losses during stress, or assignment transition costs (`strategy-economics.ts:199–237`).

Current branch-shadow builder supplies openingCosts=null, RV=null, IVrank=null, event=null, opportunityCostRate=null and5% gap scenario (`branch-economic-shadow.ts:64–80`). It chooses nearest-ATM put IV per underlying as common scenario scale; this does not establish a matched-term future physical distribution. Missing costs can leave gross scenario metrics usable but labeled; do not call them after-cost expectancy.

## Q/H/D/A/C comparison, without a new router

- **Q:** upstream ownership/bootstrap/risk/execution pipeline nominates a candidate; canonical frontier binds that nomination. Missing EV can coexist with a qualified bounded Paper research opening. Final null-EV tie may be candidate-ID driven.
- **H:** canonical branch structural objectives maximize gross premium/cushion and minimize collateral/spread (`canonical-strategy-frontier.ts:993–999`). Branch-local nominator chooses best feasible positive-size candidate only after Q does not open and an H authority receipt verifies (`hold-strike-production-decision.ts:15–41`). It invents no EV. H retains no-roll management. Existing branch economic shadow prefers risk-adjusted cushion/stress objectives, but is observation-only.
- **D:** canonical branch structural objectives maximize maximum profit and minimize maximum loss/spread (`:1000–1004`), with two-leg economics. Nominator requires Q not open, no H nomination and verified D authority, then an eligible two-leg candidate (`defined-risk-production-decision.ts:15–47`). Shadow ranks credit/max-loss, cushion, stress reward and worst-leg friction. Neither payoff max loss nor a structural candidate proves full-close feasibility.
- **Cross-branch entry priority:** actual cycle source nominates Q first, then H, then D (`theta-shadow-cycle.ts:1991–1998`). It does not maximize a calibrated common-horizon utility across these branches. This is a source ordering, not evidence any branch has current deployed authorization.
- **A:** canonical recovery stock actions carry no option-premium EV (`canonical-strategy-frontier.ts:903–934`); they require verified inventory and route into management. There is no comparable option-premium scalar that validates sell-stock versus wait.
- **C:** structural covered-call objectives use gross premium, spread and retained upside (`:1005–1009`), but ownership/encumbrance/lifecycle management owns actual action. A/C applicability prevents the entry frontier from using structural branch rank as a replacement management selector (`:1323,1351`).
- **Management A/C and open Q/H:** `paper-bootstrap-management-policy.ts:68–111,1104–1167` is an explicit deterministic, non-empirical action-utility layer over observed cashflows/current facts, not expected value; output uses known action utilities and reason codes. Missing policy/evidence can leave passive action with SYSTEM_HOLD_MISSING_EVIDENCE (`management-action-frontier.ts:452–486`). It is incorrect to infer either calibrated continuation EV from a selected policy action or optimality from fallback HOLD.

Structural rank itself is same-branch/action dominance count+1, then unknown-count, then candidate ID (`canonical-strategy-frontier.ts:993–1108`); no calibrated cross-branch dominance is implemented. `describeStructuralTopTwo` already exposes identity-only near/exact ties. `branch-economic-shadow` already records structural/economic winner disagreement and the separating key. Reuse these annotations instead of another selector.

## Smallest useful research annotations and falsifiers

1. **Selection explanation:** persist/recover existing eligibility basis, null-EV state, final ranking mode, legacy/economic winner IDs and top-two tie reason. Falsifier: claimed economic winner was actually selected solely by candidate ID.
2. **Matched counterfactual set:** preserve every feasible candidate and each exclusion stage before choosing a winner. Compare chosen versus next alternatives after costs on identical clocks/hold horizon, with unfilled/censored observations retained. Falsifier: apparent edge disappears against feasible neighboring strikes or the universe shortlist.
3. **Quantity semantics:** label every metric EV, maximum profit, gross credit, opening-cost-adjusted scenario, or stress scenario; distinguish per-unit from account size. Falsifier: a “return” improvement is solely increased credit sold against higher tail exposure or shorter calendar denominator.
4. **Unknown-dimension map:** record the exact dimensions used for each Python dominance claim. Falsifier: exclusion depends only on collateral/spread while reward/tail metrics are unavailable, yet is described as empirically inferior.
5. **Bootstrap calibration:** evaluate ownership components and severe-drawdown forecasts against qualified outcomes/OOS; preserve unknowns and approved bounds. Falsifier: ownership-score ranking adds no after-cost/tail benefit over a transparent matched baseline. Do not reinterpret structural labels as calibrated probabilities.
6. **Shadow challenge:** use existing structural-top-two and class economic-shadow receipts. Stress alternative gap sizes, volatility horizons, spread widening, delayed close, assignment and stock ownership. Falsifier: ranking reverses under modest plausible cost/tail assumptions, or “best” spread cannot close.
7. **Branch priority opportunity cost:** retain H/D candidates not nominated because Q opened, but do not execute them. Compare realized-common-horizon outcomes only with independently qualified evidence. Falsifier: fixed Q→H→D priority systematically sacrifices capital efficiency or tail outcomes; until measured it remains an untested ordering, not grounds to replace it.

No new broad tests were needed: the source unambiguously separates null EV, bootstrap eligibility, final sorting and scenario arithmetic. Any individual historical selection remains unverified without its actual receipt and qualified alternative outcomes.

## Minimal receipt-only selection annotation

No comparator counterexample was executed: its explicit final ordering is sufficient source evidence, and a synthetic renaming test would not establish historical reachability or historical selection causality.

For each existing decision receipt, derive a research annotation rather than modifying the router:
- source/deployed SHA where known, decision/snapshot IDs, actual selected candidate and `entrySelectionBasis` from canonical frontier;
- `economicRanking.mode`, `appliedToSelection`, qualifiedCandidateIds, legacy/economic selected IDs and divergence, when present;
- per candidate existing alternatives.evNet, returnPerCapitalDay, bootstrap flag, disposition, AEGIS state, quantity, execution recommendation and rejection reason (`decision-assembly.ts:104–159`);
- final tie cohort = qualified opening IDs sharing the winner's exact RPCD key, including an explicitly named ALL_RPCD_UNKNOWN cohort. Use existing qualifiedCandidateIds when supplied. When absent, reconstruct only with the sealed candidate contracts and full final eligibility inputs; alternatives alone omit contract.executable and cannot conclusively reconstruct admission;
- selection basis label: EV_RPCD, ID_TIEBREAK_AFTER_QUALIFICATION, ENFORCED_ECONOMIC_ORDER, or UNRESOLVED_INSUFFICIENT_RECEIPT. These are descriptive offline research labels, not new production enum/schema claims;
- preceding survivor/reject lineage: universe rank, Q feasible status, ownership/eligibility basis, Pareto survivor IDs and compared known dimensions, opportunity disposition, account/execution gates, then final tie cohort. Never summarize the entire system as “ignores economics.”

A tie may be final-key equal while its candidates have materially different premium, strike, expiry and tail exposure: unknown EV does not make those economic objects equal. Thus counterfactual evaluation must retain complete economics and risk evidence, not just candidate IDs. Existing `describeStructuralTopTwo` pertains to the canonical structural order; it must not be confused with the Q decision-assembly tie cohort when Q is decision-bound.
