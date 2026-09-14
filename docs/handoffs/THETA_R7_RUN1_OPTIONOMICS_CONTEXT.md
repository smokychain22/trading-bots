# THETA R7 Run 1 Optionomics context integration

Status date: 2026-09-14

This is an R7 Run 1 milestone. It does not complete R7 and it does not authorize an order.

## Production boundary completed

The runtime now has typed, read-only adapters for the six confirmed context families that were previously available only through the capability census:

- symbol metrics
- exposure heatmap
- aggregate flow
- events
- earnings filings
- symbol news

Each successful observation retains its documented operation alias, safe request parameters, request and ingestion times, provider timestamp or session date when present, HTTP status, rate-limit headers, contract version, payload hash, sanitized immutable payload, normalized state, and a one-way credential identity reference. Missing, null, malformed, and numeric zero remain distinct.

The normalizers deliberately don't create Vanna, Charm, sweep, block, ISO, aggressor-side, Greek-unit, or GEX-sign claims. Provider exposure values are stored with unverified provider units and sign semantics. Events retain publication fields without deriving an upcoming earnings date from a historical filing.

The cycle uses an explicit versioned cadence and request cap. Metrics and events can refresh every cycle. Aggregate flow refreshes every five minutes. Heatmap and news refresh every fifteen minutes. Earnings filings refresh every thirty minutes. A family that isn't due remains unobserved for that cycle. No stale value is silently carried forward.

## Layering and persistence

The canonical path is:

```text
immutable provider response
  -> normalized context family
  -> versioned Optionomics feature snapshot
  -> FusionSnapshot and point-in-time candidate evidence
```

Migration `030_optionomics_context_lineage` adds an immutable many-to-many lineage table between one normalized feature snapshot and every raw Optionomics observation used to produce it. Raw payloads stay in `market.optionomics_raw_observation`. They are not duplicated inside normalized feature JSON.

The real Neon Production database has migration 030 applied. Database verification reports the execution gate locked and zero broker orders.

## Remaining R7 limits

- Optionomics session observations remain research and strategy context. They cannot authorize broker pricing.
- A durable cross-cycle cache isn't implemented yet. Non-due families remain explicit missing context.
- Provider metric units, horizon definitions, exposure sign definitions, and full publication-time guarantees remain external contract gaps.
- Event observations exist, but upcoming earnings distance and ex-dividend state remain unknown.
- The runtime still evaluates real option candidates only for the Conventional branch. Other applicable branches don't yet produce complete independent frontiers.
- Empirical EV, action-value distributions, and profitability claims remain unavailable.

`READY_FOR_FIRST_PAPER_ORDER = NO`.
