# THETA ownership and AEGIS bootstrap audit, 2026-09-19

## Scope and evidence

This audit traces canonical `main` at `bac973b6715b76207be16af4d58345690fcb0092` and the running Paper champion at `4abeb11b170fa8ab4a849314e0c9f76ecb6ebcba`. It uses the immutable September 18 Production evidence selected by `LAST_13_OPEN_OPPORTUNITY_CYCLES_IN_WINDOW`, current source, and deterministic Python fixtures. It changes no strategy threshold, risk rule, sizing rule, execution authority, or worker process.

The 13-cycle sample contains 2,875 conventional candidates. All were structurally and risk feasible in the canonical structural frontier. There were 489 quote-usable candidates, zero candidates with known empirical after-cost EV, zero selected candidates, and zero positive quantities.

## Actual dependency graph

```text
Alpaca bars + option chain + account state + Optionomics context
  -> theta-shadow-cycle.ts input assembly
  -> ownership_contract.py
  -> ownership_v0.py
  -> strategy_router.py
  -> theta_q_baseline.py
  -> pareto_frontier.py
  -> aegis.py
  -> opportunity_frontier.py
  -> sizing.py
  -> canonical-strategy-frontier.ts
  -> master-paper-plan-assembly.ts
```

AEGIS does not consume the ownership score directly. Unknown ownership makes the THETA-Q baseline assign quantity zero before any candidate reaches AEGIS. Independently, the current Production AEGIS request retains several UNKNOWN risk-family inputs, so a hypothetical candidate that reached AEGIS would still receive `HOLD_ONLY`.

## Ownership input inventory

The JSON boundary contains 27 input members: 26 nullable evidence fields plus the separate `thesisInvalidated` boolean. Only 13 numeric evidence fields participate in the five current component scores. The other numeric inputs are accepted and preserved by the boundary but are not used by `ownership_v0.evaluate()`.

| Field | Current runtime value | Used by v0? | Classification | Expected producer | Safety role |
|---|---:|---:|---|---|---|
| stockAvgVolume | UNKNOWN | yes | FEATURE_NOT_IMPLEMENTED | PIT Alpaca daily bars | soft ownership/liquidity context |
| optionOpenInterest | UNKNOWN | yes | PROVIDER_MAPPING_MISSING | candidate Alpaca/Optionomics chain | soft ownership context, duplicated by contract gates |
| optionVolume | UNKNOWN | yes | PROVIDER_MAPPING_MISSING | candidate Alpaca/Optionomics chain | soft ownership context, duplicated by contract gates |
| spreadPct | UNKNOWN | yes | PROVIDER_MAPPING_MISSING | candidate BBO | execution safety is enforced separately |
| ret1d | derived when bars suffice | no | available | PIT Alpaca bars | research context |
| ret5d | UNKNOWN | no | SNAPSHOT_MAPPING_MISSING | PIT Alpaca bars | research context |
| ret20d | UNKNOWN | no | SNAPSHOT_MAPPING_MISSING | PIT Alpaca bars | research context |
| ret60d | UNKNOWN | no | SNAPSHOT_MAPPING_MISSING | PIT Alpaca bars | research context |
| ma20Rel | UNKNOWN | yes | FEATURE_NOT_IMPLEMENTED | PIT Alpaca bars | soft structural evidence |
| ma50Rel | UNKNOWN | yes | FEATURE_NOT_IMPLEMENTED | PIT Alpaca bars | soft structural evidence |
| ma200Rel | UNKNOWN | yes | FEATURE_NOT_IMPLEMENTED | PIT Alpaca bars | soft structural evidence |
| maSlope | derived when bars suffice | yes | available | PIT Alpaca bars | soft structural evidence |
| relativeStrength | UNKNOWN | yes | FEATURE_NOT_IMPLEMENTED | PIT candidate and benchmark bars | soft structural evidence |
| rv10 | UNKNOWN | no | SNAPSHOT_MAPPING_MISSING | PIT Alpaca bars | research context |
| rv20 | derived when bars suffice | no | available | PIT Alpaca bars | research context |
| rv60 | UNKNOWN | no | SNAPSHOT_MAPPING_MISSING | PIT Alpaca bars | research context |
| drawdown | derived when bars suffice | yes | available | PIT Alpaca bars | tail context |
| maxAdverseGap | derived when bars suffice | no | available | PIT Alpaca bars | research context |
| gapFrequency | derived when bars suffice | yes | available | PIT Alpaca bars | tail context |
| downsideSemivariance | UNKNOWN | yes | FEATURE_NOT_IMPLEMENTED | PIT Alpaca bars with unit-correct definition | tail context |
| historicalRecoveryMedianDays | UNKNOWN | yes | COLD_START_NO_HISTORY plus INGESTION_MISSING | resolved whole-chain history | confidence/research evidence |
| historicalRecoveryP95Days | UNKNOWN | no | COLD_START_NO_HISTORY plus INGESTION_MISSING | resolved whole-chain history | research evidence |
| severeDrawdownEpisodeCount | UNKNOWN | no | COLD_START_NO_HISTORY plus INGESTION_MISSING | PIT episode history | research evidence |
| earningsDistanceDays | UNKNOWN | one event distance required | RESEARCH_ONLY_FIELD plus SNAPSHOT_MAPPING_MISSING | verified event calendar | event context |
| exDividendDistanceDays | UNKNOWN | one event distance required | FEATURE_NOT_IMPLEMENTED | verified corporate-action calendar | event context |
| knownEventDistanceDays | UNKNOWN | one event distance required | SNAPSHOT_MAPPING_MISSING | normalized event observations | event context |
| thesisInvalidated | false flag | top-level hard signal only | caller flag not a verified absence | thesis/event authority | safety when positively asserted |

`ret1d`, `ret5d`, `ret20d`, `ret60d`, `rv10`, `rv20`, `rv60`, `maxAdverseGap`, `historicalRecoveryP95Days`, and `severeDrawdownEpisodeCount` do not affect the current ownership score. Their UNKNOWN state is therefore not the direct blocker.

## Composition and bootstrap finding

Current composition is a giant AND gate:

```text
LiquidityQuality KNOWN
AND StructuralQuality KNOWN
AND RecoveryQuality KNOWN
AND TailQuality KNOWN
AND EventAdjustment KNOWN
else Ownability = UNKNOWN
```

The multiplicative composition and every component formula are explicitly marked `TEST` in `ownership_v0.COMPONENT_STATUS`. The only architectural requirements are that ownership is assessed, a liquidity floor exists, an event adjustment exists, and thesis invalidation remains a separate hard signal.

Recovery quality requires prior recovery duration. The master account has no prior THETA Paper chains in the inspected sample and no Production loader supplies historical recovery input. The first Paper trade therefore requires evidence that can only be generated after prior trades. This is a confirmed cold-start bootstrap deadlock.

No approved entry bootstrap policy resolves this deadlock. The existing Paper bootstrap policy governs management of a first canary after it exists. It is not an entry ownership prior. `PAPER_EVIDENCE` permits `expectedAfterCostEv = null`, but still requires canonical selection, positive quantity, and AEGIS approval.

No fake prior, neutral substitution, or default allow was added. Selecting a cold-start treatment is a policy decision requiring an explicit versioned contract. Safe candidates for that future contract are a bounded Paper-only exploratory tier or an uncertainty-penalized external/base-rate prior. Neither is activated by this audit.

## Event, provider, and history status

- Optionomics chain data is fetched and exact-contract matched. Its OI, volume, and spread data reaches candidate contracts but is not mapped into the underlying-level ownership request.
- Optionomics event and earnings observations are contextual research records. The runtime intentionally does not convert an empty provider response into verified no-event state. Earnings, ex-dividend, and known-event distances remain UNKNOWN.
- Alpaca supplies account, positions, orders, contracts, snapshots, clock/calendar, and PIT stock bars. It does not supply the research recovery prior or proprietary ownership score.
- Whole-chain outcome tables can supply future recovery evidence after resolved episodes exist. There is no current point-in-time aggregation feeding the entry ownership request.

## AEGIS audit

Deterministic current-code fixtures prove that fully known valid AEGIS inputs return `ALLOW_FULL`, and one unknown threshold family returns `HOLD_ONLY`. AEGIS is structurally reachable and behaves as designed.

Production currently derives ticker concentration, portfolio capital at risk, provider state, cycle-level liquidity, execution quality, and gap detection when evidence is available. It still sends UNKNOWN for sector concentration, correlation-cluster exposure, inventory capacity, assignment capacity, recovery capacity, IV-shock state, and spread-widening state. Strictest-family-wins therefore yields `HOLD_ONLY` even if an ownership-complete candidate reaches AEGIS.

This is an independent Production input-completeness blocker, not an AEGIS implementation defect. No risk family was defaulted to safe.

## Deterministic fixture results

- Fully known ownership inputs: ownability `0.6066666666666667`.
- Known poor liquidity: ownability `0.0`, not UNKNOWN.
- Unused optional `ret1d = UNKNOWN`: ownability remains `0.6066666666666667`.
- Required liquidity input UNKNOWN: ownability becomes UNKNOWN.
- Fully known valid AEGIS inputs: `ALLOW_FULL`.
- One AEGIS threshold family UNKNOWN: `HOLD_ONLY`.

## Classification and action

`ROOT_CAUSE_CLASSIFICATION = MULTIPLE_ROOT_CAUSES`

1. `COLD_START_BOOTSTRAP_DEADLOCK`: prior recovery evidence is required before the first trade can create that evidence.
2. `OPTIONAL_EVIDENCE_ACCIDENTALLY_HARD_GATED`: all research-stage ownership components are composed as mandatory despite their documented TEST maturity.
3. `PROVIDER_MAPPING_DEFECT`: contract liquidity and several bar-derived facts exist but are not mapped into the ownership request.
4. `MISSING_PROVIDER_DATA`: verified event-distance and benchmark-relative-strength evidence are not currently available to the runtime.
5. Independent AEGIS input completeness keeps new risk at `HOLD_ONLY` after the ownership stage.

`AEGIS_IMPLEMENTATION_DEFECT = NO`.

`EV_UNKNOWN_IS_BLOCKING = NO` for the bounded `PAPER_EVIDENCE` tier. It remains blocking for empirically promoted Paper and any future live tier.

No runtime fix is activated because the repository has no approved cold-start entry ownership policy, and filling only the mapped fields would not remove either the recovery deadlock or the independent AEGIS UNKNOWN families. A partial change would create the appearance of progress without producing a safe executable path.

## Safety receipt

- Strategy thresholds changed: NO
- AEGIS changed or bypassed: NO
- Fake prior added: NO
- Forced trade: NO
- Alerts created: NO
- Production runtime changed: NO
- Worker restarted: NO
- Follower execution: LOCKED
- Live money authorized: NO

## Remediation implementation, 2026-09-20

The cold-start policy decision is now explicit in code as
`PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED`, policy version
`theta-paper-entry-bootstrap-v1`. It is limited to the dedicated
`MASTER_THETA_PAPER` runtime and requires a PAPER broker, ACTIVE account,
GOOD reconciliation, no local-only or external/unknown order drift, a
confirmed open market session, follower execution disabled, and live money
disabled. Passing this policy does not create an ownership score, expected
value, execution authorization, or broker action.

THETA-Q now keeps `ownershipScore = null` while allowing hard-cap quantity
calculation only when that versioned bootstrap assessment is eligible. A
known ownership result below the existing floor still produces quantity
zero. All existing contract, liquidity, event, quote-age, broker quantity,
AEGIS, sizing, execution-quality, canary, and relock gates remain in force.

Point-in-time bar mapping now supplies stock average volume, returns over
1/5/20/60 bars, moving-average-relative features over 20/50/200 bars,
realized volatility over 10/20/60 bars, downside semivariance, drawdown,
trend slope, gap frequency, and maximum adverse gap. Relative strength
remains UNKNOWN because no benchmark series is loaded. Missing history
remains UNKNOWN.

A PIT-safe recovery loader now reads only resolved whole-chain recovery
labels whose `label_available_at` is no later than the decision cutoff. It
returns median and P95 recovery days, or null values with an observed zero
episode count when no history exists. No synthetic recovery prior is used.

The candidate broker quantity is no longer the hard-coded value 5. It is
derived per contract from real options buying power, or buying power when
the options-specific field is absent, divided by verified contract
collateral. Standard-contract eligibility now requires exact OCC identity
and multiplier 100. Quantity zero remains valid.

### Updated root-cause matrix

| Root cause | Status | Evidence |
|---|---|---|
| COLD_START_BOOTSTRAP_DEADLOCK | FIXED IN CODE | Explicit uncalibrated Paper-only eligibility, ownership score remains null |
| OPTIONAL_EVIDENCE_ACCIDENTALLY_HARD_GATED | FIXED FOR PAPER BOOTSTRAP | Missing research ownership evidence no longer alone forces THETA-Q quantity zero in the bounded tier |
| OPTION_CHAIN_MAPPING_MISSING | PARTIAL | Exact contract spread/OI/volume already gate THETA-Q. They are not copied into one underlying-level ownership value because that would lose contract identity |
| BAR_FEATURE_MAPPING_MISSING | FIXED | PIT-safe 1/5/20/60 return, 10/20/60 RV, MA-relative, volume, and downside-semivariance mapping added |
| EVENT_ASSEMBLY_MISSING | REMAINS, EXTERNAL/SEMANTIC BLOCKER | Empty or unverified provider responses are not treated as verified no-event state |
| RECOVERY_HISTORY_LOADER_MISSING | FIXED | PIT query over resolved whole-chain labels, null on empty history |
| AEGIS_INPUT_INCOMPLETE | REMAINS | sector, correlation cluster, inventory capacity, assignment capacity, recovery capacity, IV shock, and spread-widening families remain UNKNOWN in Production |
| IV_PERSISTENCE_MISSING | NO CURRENT DEFECT | IV and its provenance are already retained in normalized contracts, FusionSnapshot, and persisted candidate metrics |

### September 18 aggregate offline replay

The preserved open-session diagnostic contains aggregate counts rather than
all per-candidate ownership and AEGIS input rows. The deterministic replay
therefore reports `PRESERVED_AGGREGATE_DIAGNOSTIC` and names this limitation.
It performs no provider, database, or broker call.

- total candidates: 2,875
- quote usable: 489
- bootstrap eligible: 489
- explicit ownership rejects among quote-usable candidates: 0
- reached AEGIS: 489
- AEGIS ALLOW_FULL: 0
- AEGIS ALLOW_REDUCED: 0
- AEGIS HOLD_ONLY: 489
- AEGIS block: 0
- quantity positive: 0
- action-plan eligible: 0
- broker submissions: 0

This proves the ownership circularity is removed for the preserved sample,
and also proves the independent AEGIS safety-input blocker remains. The
running worker was not restarted or cut over. Runtime activation would be
unsafe until those AEGIS families have real, versioned producers or an
explicit safety classification approved in a later bounded correction.
