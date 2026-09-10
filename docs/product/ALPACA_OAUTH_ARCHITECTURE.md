# Alpaca Customer PAPER Account Connection Architecture

Implemented application contract for the customer broker connection. Production use
remains blocked until the external Alpaca Connect application and deployment secrets
listed below are configured.

## Non-negotiable rule

**Customers never paste API keys/secrets into any frontend surface.** The master
THETA account's own Alpaca PAPER credentials remain server-side secret-manager/env
values, exactly as today (`src/config/environment.ts`) — this document is about a
*different* set of credentials: each customer's own Alpaca PAPER account, connected on
their behalf.

## Two distinct credential domains (never shared)

| | Master THETA account | Follower (customer) account |
|---|---|---|
| Credentials | Server env/secret manager only | Obtained via broker-supported authorization flow, never pasted |
| Storage | Existing `ALPACA_API_KEY`/`ALPACA_SECRET_KEY` pattern | Encrypted at rest, server-side only, keyed to tenant |
| Exposure | Never returned to any client | Never returned to any client, including the owning customer's own browser |
| Scope | Full THETA trading | Read + copy-execution scoped to that one account only |

## Flow (specification)

1. Customer clicks "Connect Alpaca Paper Account" in the Copy THETA wizard (step 1 of
   `docs/product/COPY_THETA_FLOW.md`).
2. Server initiates Alpaca's documented authorization-code flow at
   `https://app.alpaca.markets/oauth/authorize`, with `response_type=code`, the
   registered client and redirect URI, a server-owned unguessable `state`, and
   `env=paper`. The request uses `trading data`, the minimum scopes required for the
   future automatic PAPER copy worker and market-data access. Order submission remains
   independently locked by the runtime release gate.
3. State parameter is generated server-side, single-use, short-lived, and validated on
   callback (CSRF/replay protection) — PKCE used if the actual supported flow offers it.
4. On successful authorization, the resulting token is encrypted server-side before
   persistence — never logged, never returned in any API response body, never placed
   in a URL, never stored in `localStorage`/`sessionStorage`/a cookie readable by
   client JS.
5. A read-only capability/readiness check runs immediately (reusing the existing
   `checkAlpaca`-style pattern from `readiness.ts`, scoped to the customer's own
   account and PAPER environment only) to confirm: account status, options approval,
   buying power, PAPER-not-LIVE environment. Results populate the copy-readiness state
   machine (`docs/PHASE2_ENGINEERING_STATUS.md`'s existing readiness discipline,
   customer-scoped).
6. If connection or any required capability check fails, the customer sees a plain-
   language reason (`BLOCKED_BY_CONFIGURATION`-style state, per this takeover's earlier
   instruction not to fake a connected state) — never a silent fallback to "connected."

## Tenant isolation (hard requirement)

- Every stored token, position, order, and P&L record is keyed to exactly one
  customer/account id.
- No query path may return one customer's data when authenticated as another —
  enforced server-side (authorization check on every read/write), never only by
  omitting fields in a shared response.
- A failure in one follower's connection/copy pipeline must never affect another's
  (per the existing takeover instruction's R4E isolation requirement) — this extends
  to the OAuth layer: one customer's expired/revoked token must not block another's
  requests.

## PAPER vs. LIVE hard separation

- The environment (PAPER only, for the entire life of this product per current scope)
  is asserted at connection time and re-verified on every readiness check — mirroring
  `assertPaperAlpacaUrl`'s existing hard rejection of any non-`paper-api.alpaca.markets`
  host, applied to whatever the customer-OAuth equivalent connection target is.
  **No boolean `live=true` query parameter or config flag may ever bypass this.**

## Implemented routes and storage

- Start: `GET /api/v1/alpaca/oauth/start`
- Callback: `GET /api/v1/alpaca/oauth/callback`
- Disconnect: `DELETE /api/v1/alpaca/connection`
- Customer identity: password-authenticated, database-backed, opaque HttpOnly session
- OAuth state: random, SHA-256 referenced, customer-bound, ten-minute expiry, single-use
- Token vault: AES-256-GCM, customer-bound authenticated data, ciphertext only in PostgreSQL
- Account verification: PAPER host account, positions, and open-order reads before readiness

The official guide was verified on 2026-09-10 and documents the form-encoded token
exchange at `https://api.alpaca.markets/oauth/token`. See
https://docs.alpaca.markets/us/docs/using-oauth2-and-trading-api and
https://docs.alpaca.markets/us/docs/registering-your-app.

## Production owner setup

Register an application from Alpaca Dashboard, Alpaca Connect, My Developed Apps.

- Canonical callback: `https://trading-bots-one.vercel.app/api/v1/alpaca/oauth/callback`
- Environment: PAPER only, authorization request includes `env=paper`
- Scopes: `trading data`
- Vercel variables: `DATABASE_URL`, `ALPACA_OAUTH_CLIENT_ID`,
  `ALPACA_OAUTH_CLIENT_SECRET`, `ALPACA_OAUTH_REDIRECT_URI`,
  `PAPER_COPY_TOKEN_KEY_REF`, `PAPER_COPY_TOKEN_ENCRYPTION_KEY`

The Connect application must be submitted to Alpaca. Alpaca's current documentation
says live trading for other users requires approval. This product requests PAPER only.

## Status

APPLICATION PATH IMPLEMENTED. Production is `BLOCKED_BY_CONFIGURATION` until the
database, Connect application credentials, exact callback, and encryption-key variables
are configured. A real OAuth browser test cannot pass before those owner-controlled
external settings exist.
