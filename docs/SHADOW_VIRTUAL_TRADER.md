# THETA virtual shadow trader

## Purpose

The virtual shadow trader converts real point-in-time market observations into research evidence without submitting an Alpaca order. It is separate from broker-confirmed order, fill, position, and economic-chain tables.

The executable strategy remains blocked. `empirical_ev_ready=false`, `broker_submission_allowed=false`, and the global Paper execution gate remains locked.

## Opening policy

`theta-shadow-structural-baseline-v1` selects at most one cash-secured-put candidate across a completed scan. A candidate must have:

- a PUT contract with an authoritative positive multiplier
- positive quantity already bounded by the existing sizing and AEGIS pipeline
- a valid, fresh Alpaca decision BBO
- sufficient real Paper account buying power to seed the virtual collateral constraint

The ranking is deterministic. It prefers ownership acceptability, then the existing within-underlying rank, lower collateral, and finally the OCC symbol. This is a research baseline, not an empirical profitability claim.

If active virtual risk exists, opening stops with `MANAGEMENT_FIRST_ACTIVE_SHADOW_RISK`.

## Fill policy

`theta-shadow-price-through-size-v1` never assumes a decision-time fill and never uses midpoint as a fill.

A later quote must move strictly through the limit and report enough displayed size. A quote exactly equal to the limit is `UNKNOWN_EXECUTABILITY` because queue priority is unknown. Known displayed size below the requested quantity creates `PARTIAL_SHADOW`. The final EOD observation can resolve a never-crossed limit to `EXPIRED_UNFILLED`.

Fill price is conservatively recorded at the proposed limit, not at a more favorable later quote.

## Accounting

Contract premium and collateral always use the provider multiplier:

```text
gross premium = fill price × multiplier × filled quantity
secured collateral = strike × multiplier × filled quantity
```

The current canonical shadow cost model says empirical costs are not ready. Gross cashflow and collateral are therefore known, while cash, equity, realized P&L, unrealized P&L, and buying power after a fill remain `NULL`. Missing costs are not converted to zero.

## Persistence

Migration `023_shadow_virtual_trader` adds append-only research tables for:

- virtual account identity and seed provenance
- immutable shadow order intents and order-state events
- conservative virtual fills
- virtual chains and lifecycle events
- point-in-time virtual account snapshots

All rows are marked `LIVE_SHADOW`. Broker and customer copy tables are unchanged.

## Security incident boundary

Credentials pasted into chat are exposed and must not be used. Rotate the Alpaca Paper key and secret in Alpaca, then reconnect through the encrypted Account flow. The local worker stays stopped until rotation is complete. Paper and live order submission remain disabled.

## Remaining lifecycle work

The current slice supports selection, intent creation, subsequent quote observation, full or partial virtual opening fills, CSP chain creation, and collateral accounting. Position marking, close and roll intents, expiration, assignment, recovery, covered calls, stock disposal, call-away, resolved whole-chain labels, and calibrated after-cost accounting remain incomplete.
