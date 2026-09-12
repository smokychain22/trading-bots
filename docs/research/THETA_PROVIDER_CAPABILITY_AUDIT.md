# THETA Provider Capability Audit

Audit time: 2026-09-12T17:17Z  
Production build tested: `7063076`  
Broker environment: Alpaca PAPER only  
Order submission: `LOCKED`

## Research question

QUESTION = Can the currently entitled Alpaca and Optionomics accounts provide a
defensible historical point-in-time dataset that can accelerate R6 without
inventing executable quotes or projecting today's option chain backward?

WHY CURRENT EVIDENCE WAS INSUFFICIENT = Earlier records proved current Alpaca
snapshots and several Optionomics operations, but they did not test Alpaca's
historical option bars/trades contract or distinguish historical BBO and Greeks
from current snapshots.

WHAT DECISION THE RESEARCH CHANGES = Build a minimal historical adapter only if
the current entitlements supply exact historical contract identity, underlying
price, executable bid/ask, and the required point-in-time feature context.

## Secure verification path

The Production worker API now exposes one authenticated read-only operation,
`provider-evidence-readiness`. It requires the existing strong worker bearer
secret plus a complete local-worker identity. The operation resolves the
encrypted `MASTER_THETA_PAPER` credential inside Production, performs only GET
requests, returns sanitized capability metadata, and persists sanitized results
to `core.provider_capability` and `core.provider_operation_registry`.

Credential values, authorization headers, account balances, and full broker
identifiers are not returned or persisted in the capability registry. Unknown
operation selectors are rejected. The order client is never constructed by this
path.

## Alpaca, actual account entitlement

| Capability | Result | HTTP | Evidence |
|---|---|---:|---|
| PAPER account identity and status | AVAILABLE | 200 | Stored master identity matched, account ACTIVE, options approval/trading level 3 |
| Historical stock bars, IEX | AVAILABLE | 200 | 10 SPY daily observations returned, pagination token present |
| Active option contracts | AVAILABLE | 200 | 100 exact contracts returned, more pages available |
| Current option snapshots, indicative | AVAILABLE_WITH_LIMITS | 200 | 1,000 snapshots, exact contract identity and request ID observed |
| Current option Greeks, indicative | AVAILABLE_WITH_LIMITS | 200 | Greeks observed inside the real snapshot response |
| Current option snapshots/Greeks, OPRA | NOT_ENTITLED | 403 | Provider response, not inferred from Paper mode |
| Historical option bars | AVAILABLE_WITH_LIMITS | 200 | 9 daily observations for one exact contract through the account-default indicative feed |
| Historical option trades | AVAILABLE_WITH_LIMITS | 200 | 10 observations for one exact contract, more pages available |
| Historical option BBO | NOT_SUPPORTED | n/a | Current official Alpaca endpoint inventory has historical bars/trades and latest quotes/snapshots, but no historical option quote REST endpoint |
| Historical option Greeks | NOT_SUPPORTED | n/a | Current official Alpaca endpoint inventory exposes Greeks on current snapshots, not historical Greeks |
| Corporate actions | AVAILABLE | 200 | Read-only response object returned |

The first bars/trades probe returned HTTP 400 because it sent a `feed` query
parameter that those two official endpoint contracts do not accept. Root cause:
`DATA_CONTRACT_MISMATCH`. The parameter was removed, tests now assert that it is
never sent, and the repeated Production probe returned HTTP 200 for both
operations.

Official references:

- [Alpaca historical option data](https://docs.alpaca.markets/us/docs/historical-option-data)
- [Alpaca historical option bars](https://docs.alpaca.markets/us/reference/optionbars)
- [Alpaca historical option trades](https://docs.alpaca.markets/us/reference/optiontrades)
- [Alpaca options market-data endpoint inventory](https://docs.alpaca.markets/us/docs/options-trading-overview)

## Optionomics, actual account entitlement

The adapter first discovered the live API reference and found 41 documented
paths. It then called only documented operations using the configured email and
token header contract.

| Capability | Result | HTTP | Shape evidence |
|---|---|---:|---|
| Authentication/tickers | AVAILABLE | 200 | Rate-limit headers present |
| Current IV | AVAILABLE | 200 | IV fields present in metrics and option-chain responses |
| Current skew | AVAILABLE | 200 | Skew fields present in metrics response |
| Current term structure | AVAILABLE | 200 | Term fields present in metrics response |
| Current volatility surface | AVAILABLE_WITH_LIMITS | 200 | Exact option-chain IV by contract is available for derivation, but the metrics response contains no direct surface field |
| Option chain and Greeks | AVAILABLE | 200 | IV and dated fields present in a real chain response |
| Price history | AVAILABLE | 200 | Dated historical response present |
| Historical IV/skew/term/surface API | UNVERIFIED | n/a | Current tested history route did not contain IV, skew, term, or surface fields, and no undocumented date query was guessed |
| Flow/UOA, current net operation | AVAILABLE | 200 | Documented route authenticated, rate-limit headers present |
| Current/24h/48h crowd trajectory | UNVERIFIED | n/a | The tested net-flow contract did not prove three independent dated horizons |
| Events | AVAILABLE | 200 | Dated response shape and rate-limit headers present |
| Date-aware option analytics | UNVERIFIED | n/a | Product documentation describes Time Travel, but authenticated product UI capability is not treated as an API contract |

Official product documentation confirms historical analytics and volatility
surface features are plan-gated and snapshot-based. The API audit deliberately
does not translate product-page availability into an undocumented API route:

- [Optionomics Volatility Surface](https://docs.optionomics.ai/analytics/volatility-surface/)
- [Optionomics Historical Lab](https://docs.optionomics.ai/analytics/history/)
- [Optionomics plans](https://docs.optionomics.ai/getting-started/plans/)

## Historical PIT decision

HISTORICAL_PIT_ACCELERATION = `BLOCKED_ON_PROVIDER`

No historical adapter was added. Historical option bars and prints cannot
reconstruct the executable decision-time BBO, and current snapshot Greeks
cannot be projected backward. Optionomics's tested price-history route does not
fill those gaps. Building an adapter from this evidence would create false fill
and feature certainty.

The live-shadow worker remains the primary defensible evidence source. Its
first supported open session must capture the real decision BBO, timestamps,
current Greeks/IV, provider provenance, complete candidate-set scope, and later
quote observations through the existing evidence schema.

## Production persistence and safety proof

- Provider connections: 2, Alpaca PAPER and Optionomics RESEARCH
- Current sanitized capabilities: 18
- Schema migrations: 22, head `022_disabled_copy_engine_closure`
- Broker orders: 0
- Broker fills: 0
- Candidate sets: 0
- Candidates: 0
- Shadow scans: 0
- Dataset exports: 0

R6 therefore remains `BLOCKED_ON_DATA`. The provider audit resolves entitlement
uncertainty, but it does not create observations, labels, empirical expectancy,
or permission to trade.
