# THETA Production closure wave 1, bounded evidence receipt

Canonical baseline inspected: `0aa1aef891d2396b3a8359cd4d670141ee747449`.
The worker was not restarted or unlocked. This receipt distinguishes source work
from a verified runtime release. Alpaca Paper is the only permitted broker mode.

## Claude `c53d9145575d0dbb396485897fc7ba328c74f0da` file review

| File | Classification | Reason |
| --- | --- | --- |
| `src/research/paper-bootstrap-candidate-source.ts` | RESEARCH_ONLY | Pure enumeration prototype, but its fresh CC path derives identity/multiplier from the first observation and it does not fetch or persist actual broker candidate sets. It cannot be a Production source as written. |
| `tests/paper-bootstrap-candidate-source.test.ts` | RESEARCH_ONLY | Tests the prototype, not broker read, completeness, persistence, or management-plan reachability. |
| `src/theta/paper-bootstrap-management-policy.ts` | PORT_SELECTIVELY | Optional 0.10/5 defaults preserve prior behavior. Canonical port adds finite/range validation and decision-receipt provenance. No empirical claim. |
| `tests/paper-bootstrap-management-policy.test.ts` | PORT_SELECTIVELY | Canonical tests cover default behavior, an override, invalid input, and persisted reason-code provenance. |
| `docs/research/THETA_PAPER_BOOTSTRAP_CANDIDATE_SOURCE_INTEGRATION_NOTE.md` | REJECT | Its suggestion to consider wiring Pipeline B conflicts with the canonical dependency proof and one-management-authority rule. The prototype's useful enumeration concept can be reused without adopting that suggestion. |
| `docs/research/THETA_AEGIS_FIRST_PAPER_POLICY_GAP.md` | RESEARCH_ONLY | Its narrower producer finding is supported by source review. First-Paper required/optional status is unresolved policy authority and must not be changed by a research document. |
| `docs/research/THETA_R8_HOLD_STRIKE_PREREGISTRATION_ERRATUM.md` | RESEARCH_ONLY | The 2-5 versus 25-60 DTE geometry correction is valid. The frozen original and subsequent v2 live on the research branch. No outcome-based promotion follows from the erratum. |

Pipeline B remains quarantined under
`docs/research/THETA_DUPLICATE_MANAGEMENT_PIPELINE_DEPENDENCY_PROOF.md`.
The canonical management authority remains `autonomous-runtime.ts` ->
`PaperBootstrapManagementPolicyProvider` -> management frontier -> Paper-plan
assembly. Its current default candidate source returns no roll/CC candidates.
ROLL, SELL_CC, and ROLL_CC must not be reported as fully reachable in the
running worker.

## Real September 21 candidate funnel

Reproduced from Aiven's persisted `trade.shadow_opportunity` and
`trade.candidate_point_in_time_evidence` through the read-only
`tools/windows/dr/Inspect-ThetaCandidateFunnel.ps1` command. No synthetic
candidate, broker mutation, or write query was used.

| Result | Rows |
| --- | ---: |
| All candidate/shadow rows | 3,876 |
| CONTRACT_NOT_EXECUTABLE | 3,299 |
| DELTA_OUTSIDE_ALL_BANDS | 416 |
| OPEN_INTEREST_BELOW_FLOOR | 53 |
| OWNERSHIP_ACCEPTABILITY_UNKNOWN | 48 |
| UNKNOWN_DELTA | 39 |
| VOLUME_BELOW_FLOOR | 20 |
| BROKER_QTY_ZERO | 1 |

The 3,299 `CONTRACT_NOT_EXECUTABLE` details comprise 2,014 `quote stale;
spread too wide`, 787 `spread too wide`, and 498 `quote stale`. This is
evidence against the prior multiplier-only hypothesis. A sample persisted
contract has multiplier 100, an `INDICATIVE` bid/ask, and a provider quote
timestamp. The contract-level gate enforces 30-second age and a versioned
maximum spread. These observations do not justify relaxing either gate.
All 3,876 point-in-time candidate rows have `aegis_json.state = null`.
That means no candidate AEGIS assessment was persisted in this funnel. It
does **not** prove that every row failed AEGIS. Upstream quote, delta,
liquidity, ownership, and one broker-quantity outcome must be reported
separately. The live Python AEGIS SYSTEM family would still be HOLD_ONLY
when either missing stress input is sent as null, but a real candidate
reaching that stage needs separate proof.

## AEGIS stress-input decision table

| Field | Why it exists | Real producer now | Data needed | Derivable today | Safety role | Hard-required cost | Optional risk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `stressIvShockDetected` | Detect a volatility regime shock before adding short-volatility risk | No | PIT current IV, aligned historical IV baseline, observation count/window, versioned shock rule | No verified baseline wired | Potential safety modifier, first-Paper authority unresolved | Permanent SYSTEM HOLD_ONLY while null | An unobserved IV shock could be ignored |
| `stressSpreadWideningDetected` | Detect deteriorating option execution liquidity | No | Current exact-contract Alpaca BBO, PIT spread history, freshness, baseline count/window, versioned widening rule | Historical BBO rows exist, but no qualified detector/baseline | Execution-safety relevant, first-Paper authority unresolved | Permanent SYSTEM and LIQUIDITY HOLD_ONLY while null | A widening market could be misclassified safe |

`stressGapDetected` has a real one-day-return derivation when history exists.
The single-underlying sector/correlation values are narrow account-derived
proxies, not general multi-position sector or correlation producers.
No `UNKNOWN -> false` conversion was made. The exact required/optional
policy requires a governed decision and real producer evidence.

The Aiven source currently contains **zero** rows in
`market.option_quote_snapshot`. Candidate PIT evidence contains 3,876 rows
across 1,696 distinct contracts on September 21, 4,590 rows across 607
contracts on September 18, and 139 rows across 59 contracts on September 16.
Those records are useful historical observations, but they do not yet prove
an adequate per-contract rolling spread baseline or a qualified IV-shock
baseline. A detector must check observation counts and temporal alignment
before it can produce either boolean. This is why a simple `null -> false`
mapping would be false safety.

## Remaining closure gates

* Infrastructure: Aiven still reports `default_transaction_read_only=on`
  and `pg_is_in_recovery=false`. Its database size is 687,044,287 bytes.
  A prior database error said `No space left on device`, but exact plan,
  allocated capacity, WAL overhead, threshold, and supported remedy have
  not been obtained from the Aiven control plane. The verified local backup
  and restore remain preserved. No deletion or write-mode override was tried.
* Engineering: real management roll/CC candidate sourcing, exhaustive
  candidate persistence, real IV/spread stress producers, shadow Hold-Strike
  and Defined-Risk candidate generation, and current-worker release proof
  are open. `deltaResearchBuckets` has no Production consumer, so it is
  dead configuration for now. Its intended research-cohort use cannot be
  described as live delta adaptation.
* Policy/provider: prospective earnings negative coverage, corporate-action
  negative assurance, event-near semantics, and AEGIS stress-input
  applicability remain governed/qualified separately. None is silently
  changed to false.
* R8 empirical: cross-strategy common-horizon utility and continuation EV
  remain untrained. Defined Risk remains research-only.

No real provider no-submit eligibility proof can pass while Aiven cannot
persist an intent and the required evidence remains unresolved. New risk,
follower execution, and live money stay locked.
