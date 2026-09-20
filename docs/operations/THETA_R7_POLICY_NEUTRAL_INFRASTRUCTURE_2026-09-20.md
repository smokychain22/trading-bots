# THETA R7 Policy-Neutral Risk Evidence Receipt

Date: 2026-09-20

This slice adds evidence producers and research contracts only. It does not select risk policy, change the live champion, restart the worker, promote a model, or authorize a new strategy.

## Severe drawdown

- Dataset materializer consumes a complete owner or research supplied `SevereDrawdownLabelSpec`.
- No horizon or threshold has a default in the materializer.
- Labels preserve `BREACHED`, `SURVIVED`, and `CENSORED`.
- Breach labels become available on the breach date. Survival labels become available only at the completed horizon. Censored labels remain unavailable.
- Overlapping same-underlying windows share a dependence group.
- Ambiguous corporate actions exclude a label. Only split-adjusted or all-adjusted paths can produce a label.
- Features carry an explicit version and must have been available no later than the decision date.
- Dataset rows are deterministic and content hashed.

Policy status: `MISSING`. The horizon and severity threshold remain unresolved authority decisions.

## Point-in-time feature production

The TypeScript materializer reuses canonical Alpaca historical bars and existing feature functions. Callers must supply every window, the gap threshold, feature version, data version, adjustment, and as-of time. It produces returns, simple moving averages, realized volatility, trend, drawdown, adverse gaps, gap frequency, downside semivariance, and average volume. Missing history remains `null` and is listed explicitly.

The companion historical extraction manifest records the explicit eligible universe, request window, as-of and retrieval instants, feed, timeframe, adjustment, data version, observed dates, missing underlyings, and a deterministic content hash. It filters the canonical Alpaca bars rather than creating another market-data universe.

## Correlation evidence

The correlation producer emits pairwise Pearson observations from synchronized close-to-close log returns. Lookback is an explicit caller input. Insufficient overlap and zero variance remain `UNKNOWN`. The producer does not define a correlation threshold or cluster policy.

## Event evidence

Optionomics and Alpaca corporate-action observations now have a common normalization contract. Provider identity, provider event ID, event time, known-at time, observed-at time, applicability, and payload hash are retained. Future-known observations become invalid for the decision. Conflicting duplicate identities remain visible as `CONFLICT`.

## IV and spread histories

The canonical decision funnel already persists contract IV inside `trade.candidate_point_in_time_evidence` and two-sided quote observations inside `market.execution_quote_observation`. Migration 062 exposes a null-safe `research.option_contract_risk_history` view over those records. This avoids a second collection path. The view includes provider and ingestion timestamps, feed, operation alias, quote contract version, data quality, feature and strategy versions, and source hashes.

## Model research contracts

The Python model contract defines chronological purged folds, immutable content-hashed artifacts, a research training-plan contract, a hash-validating artifact registry, and fail-closed inference. Research-only or uncalibrated artifacts cannot emit runtime risk probability. No model was fitted or promoted in this slice.

## Canonical policy registry

Current status:

| Policy | Status | Exact blocker |
|---|---|---|
| Severe drawdown | MISSING | Horizon and severity threshold are not approved |
| Correlation clustering | MISSING | Lookback and cluster policy are not approved |
| Sector mapping | MISSING | An authoritative sector source and mapping version are not selected |
| IV shock | MISSING | IV horizon and shock policy are not approved |
| Spread widening | MISSING | Baseline window and widening policy are not approved |

The registry rejects `APPROVED` entries that lack a policy version and evidence reference.

## Sector source research

The current Alpaca historical-bar and asset integration has no canonical sector field. SEC EDGAR exposes public company submission data and SIC classifications, but SIC-to-sector conversion still requires a versioned mapping and rules for ETFs, funds, foreign issuers, missing CIK mappings, and reclassifications. Sector policy therefore remains `MISSING`, not inferred.

Primary reference: <https://www.sec.gov/search-filings/edgar-application-programming-interfaces>

## Runtime safeguards

- Live worker restart required: no.
- Strategy thresholds changed: no.
- DTE, delta, AEGIS, sizing, quote rules, and execution authorization changed: no.
- Follower execution changed: no.
- Live money capability changed: no.

## Production default hygiene audit

- `REPLAY_FIXTURE` and lifecycle fixtures remain isolated to typed research or test contracts.
- Optionomics session-recorded observations remain `RESEARCH_ONLY` and cannot become execution-price authority.
- Research rankings remain non-executable.
- The Paper bootstrap management policy is explicitly versioned and remains the current bounded Paper baseline, not an empirical profitability claim.
- The live worker registers the historical strategy label `theta-shadow-once-v1`. That label is operational metadata. Broker mutation still requires the separate master Paper authorization and execution controls.
- No test fixture was found wired as broker authority in this slice.
