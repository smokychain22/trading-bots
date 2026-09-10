# THETA v1.2 PAPER Copy Extension

Status: deterministic contract and persistence schema implemented. Runtime I/O, order submission, and copy activation are disabled.

## Scope

This extension prepares a customer flow from THETA's master PAPER decisions to follower-specific PAPER execution. It does not change THETA v1.1 strategy rules, financial math, provider authority, lifecycle truth, or database truth.

The required decision path is:

1. A reconciled master THETA decision or fill becomes eligible for copy evaluation.
2. Each follower's Alpaca PAPER connection and account state are checked independently.
3. Follower AEGIS and follower limits are applied.
4. Follower sizing produces a non-negative quantity. Quantity zero remains valid.
5. The follower may COPY, COPY_REDUCED, SKIP, WAIT, or REJECT.
6. A child order may be created only after every release gate and authorization succeeds.
7. Follower order, fill, lifecycle, and P&L are reconciled independently.

Master quantity is never copied raw. A master trade does not guarantee a follower trade. Joining an existing master position defaults to off.

## Alpaca authorization contract

Alpaca's current official Trading API OAuth guide documents an authorization-code flow at `https://app.alpaca.markets/oauth/authorize`, a server-side form-encoded code exchange at `https://api.alpaca.markets/oauth/token`, an unguessable `state`, and `env=paper` to restrict consent to a paper account. Read-only endpoint access is the default. The `trading` scope authorizes order actions, so it must not be requested until the paper-copy execution milestone is explicitly approved.

References:

- https://docs.alpaca.markets/us/docs/using-oauth2-and-trading-api
- https://docs.alpaca.markets/us/docs/registering-your-app
- https://docs.alpaca.markets/us/docs/about-connect-api

The current application exposes no OAuth start or callback endpoint. Customer IAM, signed state ownership, callback replay protection, encrypted token-reference persistence, account tenancy, revocation, and audit storage are missing. The Connect button therefore remains disabled.

## Current API foundation

- `GET /api/v1/copy/readiness` returns customer-safe readiness only.
- `GET /api/v1/copy/results` returns follower-only results and never reuses master performance.
- `POST /api/v1/copy/policy/validate` validates a stateless draft and always returns `activation_allowed=false` and `final_quantity=0`.
- `src/customer/copy-engine-contract.ts` produces deterministic follower plans. It adapts quantity, preserves quantity zero, maps rolls to close plus open, and requires reconciliation for partial, rejected, divergent, or ambiguous broker state.
- `migrations/005_follower_copy_engine.sql` persists follower accounts by opaque secret reference, versioned account limits, stable copy events, child order intents, immutable fills, reconciliation facts, and operator audit events.
- No secret, access token, account identifier, authorization header, or master account data is returned.
- No order endpoint is called.

## Release gates

Before the first follower PAPER copy:

- customer identity and tenant authorization
- registered and approved Alpaca Connect application
- server-side OAuth state and callback validation
- encrypted token storage by opaque secret reference
- read-only follower account and entitlement verification
- a production persistence adapter and customer tenancy enforcement over the follower schema
- master decision or fill ingestion and lineage
- follower AEGIS and sizing integration
- broker-backed child order submission and ambiguous-submission reconciliation
- partial-fill and cancel/replace handling
- follower lifecycle and whole-chain economic ledger
- pause, stop, and revocation semantics
- paper-only end-to-end and chaos tests

LIVE trading remains outside this extension.
