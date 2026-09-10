# Customer vs. Admin Information Boundary

Specification, not yet implemented in UI code (per this correction's own priority
order — R1-R4 runtime finishes first; UI wiring is step 5). This document is the
single source of truth for what customers see vs. what only the private owner/operator
console (`/ops`) may show, so no future UI change accidentally leaks the wrong side of
this line.

## Principle

Customers get **plain-language economic truth about their own account and THETA's
observable behavior**. They never get **proprietary model internals, other tenants'
data, or private strategy mechanics** that would let a copier reverse-engineer the
edge or that would expose one customer's account to another.

## Customer-visible (plain language, own-account scoped)

- THETA's current bot status (Preparing/Ready/Running/Paused/Managing
  position/Waiting for opportunity/Broker disconnected/System issue) and copy status
  (Not connected/Setup required/Ready to copy/Copying/Paused/Stopped) — both truthful,
  never fabricated to look more "active" than backend state supports.
- Their own connected account's positions, trades, activity, and P&L
  (`WholeChainPnL` broken into realized/unrealized/stock/option/fees — never a single
  blended number that hides an open stock loss).
- Plain-language reasoning for a decision affecting *their* account ("Microsoft passed
  ownership checks. Premium compensated for modeled downside risk. Liquidity was
  acceptable.") — the reasoning categories, not the numeric thresholds or model
  internals that produced them.
- Why their own follower behavior diverged from master (skip reasons in
  understandable language: "your available allocation supported 0 contracts," "your
  option spread was too wide").
- Aggregate, already-validated performance metrics for THETA itself when real evidence
  exists (Managed Episode WR, PF, max DD, etc., per `docs/quant/phase2/` provenance
  discipline) — never a number invented to fill an empty screen.

## Admin/owner-only (`/ops`, never in customer navigation)

- Expert-DNA research, hypothesis registry, model feature weights, calibration
  internals, exact policy thresholds (ownership floor, AEGIS caps, sizing formulas).
- The full opportunity book: every candidate evaluated (OPEN/WAIT/PASS/AEGIS-rejected/
  Q=0), ranked, with `EV_net`/tail-adjusted economics/uncertainty per candidate.
- The decision frontier for any given state: every alternative action's utility, the
  runner-up, and why it lost — this is exactly the kind of detail that would let a
  sophisticated user reverse-engineer the strategy if exposed customer-side.
- Cross-tenant/follower data: any other customer's account, positions, allocation, or
  P&L. A given customer's `/ops`-equivalent view (if one ever exists) must be scoped
  to their own account only, enforced server-side, never by hiding UI elements alone.
- Provider/broker internals beyond what's needed to explain a skip (raw API responses,
  latency, provider capability matrices, Optionomics feature payloads).
- Research/validation state (baseline vs. challenger vs. shadow vs. validated vs.
  rejected), walk-forward/OOS results, ablation tables.
- Execution internals (`client_order_id`, broker order IDs, raw quote/BBO history,
  reconciliation state) beyond a plain-language "skipped because your spread was too
  wide."

## Enforcement discipline

This boundary is a **server-side authorization boundary**, not a UI convention — the
existing private operator endpoint (`src/providers/readiness-handler.ts`) already
establishes this pattern (Bearer-token-gated, `trading: 'disabled'` unconditionally at
this stage) and any future customer-facing endpoint must be built as a genuinely
separate, narrower-scoped API surface, never the same endpoint with fields
conditionally hidden client-side. `src/customer/models.ts`'s existing types
(`BotStatus`, `BotSummary`, etc.) already model the customer-safe shape distinct from
private internals — this document formalizes the line those types already implicitly
draw, so future additions to either surface can be checked against it.

## Status

SPECIFIED. No UI code changed by this document. Existing customer-model separation in
`src/customer/models.ts` and the private `readiness-handler.ts` are consistent with
this boundary and require no correction — this doc exists so future additions don't
drift from it.
