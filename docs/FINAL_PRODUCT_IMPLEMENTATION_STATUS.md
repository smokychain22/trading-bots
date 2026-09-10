# THETA product implementation status

As of 2026-09-10, the standalone product presents the complete customer and owner
information architecture while keeping all trading mutations disabled. Website
deployment readiness and bot execution readiness are separate states.

## Working customer product

- Home adapts to disconnected, ready-to-copy, and active-copy participation states.
- Bots identifies THETA as the only active project. ATLAS, NEXUS, VEGA, EVENT, and
  PULSE remain unavailable research roadmap entries.
- THETA includes Overview, My Results, Positions, Trade History, Performance, and an
  educational How It Works route.
- My Results is follower-only. It never presents master-account results as customer
  results.
- Copy THETA uses a three-step flow: connect paper account, choose an amount, then
  review and start. Activation remains disabled.
- My Bots explains active and stopped-new-entry semantics. Account explains that
  disconnection stops management and never liquidates automatically.
- Customer position and trade-history views expose no close, roll, buy, sell,
  cancel, or replace control.
- Missing values remain unavailable. Demo values remain opt-in and labeled.

## Working owner product

The server protects `/ops` and every `/ops/*` route except `/ops/login`. An authenticated
owner can inspect five focused views:

1. Overview, release state, master connection metadata, publication state, and gates.
2. THETA, current decision evidence, AEGIS state, pipeline, and economic truth.
3. Trading, read-only provider verification, positions, orders, fills, and reconciliation.
4. Copy, deterministic contract readiness, follower states, and safety semantics.
5. System, component health and release gates.

The console exposes no trading mutation. The provider verification action is read-only.

## Copy-engine foundation

`src/customer/copy-engine-contract.ts` and migration 005 define the stable boundary
from a reconciled master fill to a follower-specific plan. The contract:

- never copies raw master quantity
- allows quantity zero
- supports full, reduced, skipped, blocked, duplicate, and reconcile outcomes
- maps a roll to close-old plus open-new in one lineage
- continues lifecycle management after Stop New Copies
- records disconnect and assignment divergence
- requires reconciliation for partial fills, rejections, manual position changes,
  and unknown submission state
- never authorizes execution in this milestone

The database stores only an opaque OAuth secret reference. It has no plaintext token
column. Copy events, fills, reconciliation facts, and operator audit facts are
append-only.

## Remaining external and runtime gates

These items cannot be represented as completed until real external authority and
runtime evidence exist:

- customer identity and tenant authorization
- approved Alpaca Connect application and paper-only OAuth callback ownership
- encrypted secret manager integration and revocation
- follower account and entitlement adapter
- durable master-fill ingestion
- follower AEGIS and runtime sizing adapter
- PAPER child-order submit, cancel/replace, fills, lifecycle, and broker reconciliation
- scheduler and recovery workers
- provider-backed economic publisher and validated performance sample
- per-owner IAM, MFA, roles, and durable audit attribution
- Docker schema execution on a running local Docker engine

No live order and no paper order was submitted by this milestone.
