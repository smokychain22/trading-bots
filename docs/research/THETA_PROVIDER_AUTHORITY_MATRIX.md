# THETA Provider Authority Matrix

Status date: 2026-09-13

This matrix governs R3, R4, R6, R7, R8, and R9. Provider identity alone never
establishes data quality. Every observation retains its operation alias,
timestamps, units, schema version, quality state, and missing reason.

| Truth domain | Primary authority | Allowed use | Current state |
|---|---|---|---|
| Account, buying power, positions, orders, fills | Alpaca | Reconciliation and Paper execution | Proven on Paper |
| Assignment, exercise, expiration, corporate actions | Alpaca | Lifecycle truth | Read-only capability proven, lifecycle evidence required per event |
| Underlying executable market state | Alpaca | Limit-price and risk input | Feed identity retained |
| Option contract identity and tradability | Alpaca | Broker-valid order contract | Proven |
| Option executable price | A qualified two-sided quote contract | Limit-price input only after qualification | Not ready |
| IV, skew, term, surface | Optionomics | Research and decision context | Partly proven by authenticated operations |
| Flow, UOA, OI, crowd windows, events | Optionomics | Research context, then policy only after ablation | Partly proven by authenticated operations |
| GEX, DEX, Vanna, Charm, walls, flips | Optionomics when documented and entitled | Separate feature families, never a directional oracle | Capability audit incomplete |
| Wheel and management mechanisms | QuantWheel public material | Hypotheses and UX benchmark | Reference only |
| Copy execution and verified performance mechanisms | Alertsify public material | Hypotheses and product benchmark | Reference only |

## Executable option quote rule

The gate is `FRESH_TRUSTED_TWO_SIDED_OPTION_QUOTE_READY`.

An Alpaca quote qualifies only with proven OPRA consolidated provenance. An
Optionomics quote may qualify under the narrower
`OPTIONOMICS_TRUSTED_TWO_SIDED_QUOTE` authority only when an authenticated,
documented operation proves exact contract identity, bid, ask, provider time,
freshness, units, and documented suitability for order pricing. It must not be
called raw OPRA or NBBO unless the response provenance proves that exact claim.

Current result: `FRESH_TRUSTED_TWO_SIDED_OPTION_QUOTE_READY = NO`.

Current Alpaca OPRA result is `NOT_ENTITLED`. Current Optionomics operations
prove research context but do not yet prove the quote contract above. No runtime
execution gate is widened by this document or by the provider-neutral validator.

## Non-provider inputs

FRED, SEC EDGAR, and bounded Cboe public research inputs remain approved only
for specific macro, filing, event, and public volatility fields. QuantWheel and
Alertsify are not runtime providers. Adding either requires a documented missing
field, security and licensing review, and a controlled incremental-value test.
