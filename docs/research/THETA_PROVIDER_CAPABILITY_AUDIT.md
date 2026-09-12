# THETA Provider Capability Audit

Audit time: 2026-09-12T17:51Z

Production build tested: `57eb9784268fc7820f43e2114391ebba25c27535`

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
| Historical IV/skew/term | AVAILABLE_WITH_LIMITS | 200 | Documented `date` query returned the requested 2026-09-04 session with 83 metric entries and IV/skew/term fields |
| Historical option-chain analytics | AVAILABLE_WITH_LIMITS | 200 | Documented `date` query returned 12,456 exact-contract rows with IV and dated fields |
| Historical volatility surface | AVAILABLE_WITH_LIMITS | 200 | Research-only strike by expiration by IV grid can be derived from the exact dated chain. No direct surface field was claimed |
| Flow/UOA, current net operation | AVAILABLE | 200 | Documented route authenticated, rate-limit headers present |
| Historical flow aggregates | AVAILABLE_WITH_LIMITS | 200 | Dated query returned five rows in each documented aggregate list |
| Current/24h/48h crowd trajectory | AVAILABLE_WITH_LIMITS | 200 | Bounded `from`/`to` queries returned 0/0 points for the closed-session 8h window, 81/81 points for 24h, and 162/162 points for 48h. Empty is not interpreted as zero sentiment |
| Events | AVAILABLE | 200 | Dated response shape and rate-limit headers present |
| Historical event context | AVAILABLE_WITH_LIMITS | 200 | Thirty-day bounded query returned four events and all four retained `known_at` |
| Date-aware option analytics | AVAILABLE_WITH_LIMITS | 200 | Only documented `date`, `from`, and `to` parameters were used |

Official product documentation confirms historical analytics and volatility
surface features are plan-gated and snapshot-based. The API audit deliberately
does not translate product-page availability into an undocumented API route:

- [Optionomics Volatility Surface](https://docs.optionomics.ai/analytics/volatility-surface/)
- [Optionomics Historical Lab](https://docs.optionomics.ai/analytics/history/)
- [Optionomics plans](https://docs.optionomics.ai/getting-started/plans/)

## Historical PIT decision

HISTORICAL_CONTEXT_ACCELERATION = `AVAILABLE_WITH_LIMITS`

HISTORICAL_EXECUTION_PIT_ACCELERATION = `BLOCKED_ON_PROVIDER`

Historical option bars and prints cannot reconstruct the executable
decision-time BBO, and current snapshot Greeks cannot be projected backward.
Optionomics's dated analytics can accelerate descriptive research for IV, skew,
term structure, flow, surface context, and events. They do not fill the missing
historical executable BBO or historical Greeks boundary. Building a fill-level
adapter from this evidence would create false execution certainty.

The shadow cycle now captures the documented 8h, 24h, and 48h net-flow windows
inside its immutable FusionSnapshot. Complete provider points and query bounds
are retained once in the snapshot. Candidate evidence stores compact window
counts and last observed points plus the snapshot reference. These inputs remain
`RESEARCH_CONTEXT_ONLY`. No call/put direction, aggressor, opening/closing state,
or trader profitability is inferred.

The live-shadow worker remains the primary defensible evidence source. Its
first supported open session must capture the real decision BBO, timestamps,
current Greeks/IV, provider provenance, complete candidate-set scope, and later
quote observations through the existing evidence schema.

## Production persistence and safety proof

- Provider connections: 2, Alpaca PAPER and Optionomics RESEARCH
- Current sanitized capabilities: 26
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
