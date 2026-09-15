# THETA P2G synthetic lifecycle and dry-run proof

P2G closes a production-engineering evidence gap without claiming market edge or creating a broker order.

## Isolation contract

Synthetic lifecycle receipts are stored only in `research.theta_synthetic_lifecycle_receipt`. Every row is immutable and fixed to:

- `evidence_origin = SIMULATED`
- `execution_authorized = false`
- `real_paper_evidence = false`
- `policy_learning_eligible = false`

Dry-run receipts are stored only in `research.theta_paper_order_preview_receipt`. Database checks permanently require `submit_to_broker = false` and `paper_order_created = false`. Neither receipt contributes to broker fills, real R8 samples, TCA, policy learning, or performance claims.

## Lifecycle proof

The deterministic full-chain fixture covers CSP entry, an immutable loss on the rolled old leg, a new premium leg, assignment, stock recovery wait, covered call, call-away, terminal whole-chain economics, fees, and capital-days. The scenario catalog also includes profit-giveback, loss-path, WAIT, HOLD, churn, 0DTE/1DTE, expiry, assignment, and call-away cases.

The simulator proves accounting and state mechanics. It does not prove profitability or provide training labels.

## Paper order preview

The preview supports one or multiple explicit option legs. It records exact OCC identity, position intent, ratio, quantity, expiration, DTE, pricing semantics, quote age, package price, maximum risk, capital, AEGIS, portfolio effects, operator state, persistence, and idempotency. A ready preview remains mechanically non-submittable.

Order pricing is provider-neutral. Qualification requires exact-contract identity, authenticated provenance, documented order-pricing use, a fresh valid two-sided quote, and either `CONSOLIDATED_NBBO` or `TRUSTED_TWO_SIDED_ORDER_PRICING` semantics. Paid OPRA is not a universal requirement. Alpaca indicative data and undocumented Optionomics session research observations remain disqualified.

## Provider family health

Vega capability families are evaluated independently. Empty, partial, stale, timestamp-free, identity-free, schema-drifted, duplicate-page, and pagination-loop responses are explicit failures. A healthy chain response cannot make GEX, flow, or another unproven family healthy.

Massive Free is not added. No unique required field has been proven missing from Alpaca broker truth plus the intended Optionomics intelligence contract. This avoids another runtime authority and does not block P2G.

## Activation boundary

The first real Paper activation remains blocked until an actual candidate produces a complete fresh quote-qualified dry-run receipt and every existing account, session, policy, AEGIS, persistence, scheduler, reconciliation, and operator gate passes. Follower submission and live trading remain disabled.
