# Alpaca Customer PAPER Account Connection Architecture

Specification for R3C (customer broker connection). Not yet implemented — this is the
design a future implementation must follow, so a real OAuth build doesn't have to be
re-derived from scratch, and so no interim implementation ever asks a customer to paste
a raw API secret into the browser.

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
2. Server initiates the broker-supported authorization flow (OAuth-style redirect, or
   whatever mechanism Alpaca's actual current API contract supports for third-party
   account connection — **this must be verified against Alpaca's real, current
   documentation before implementation**, not assumed from memory, since broker APIs
   change; do not guess an endpoint shape the way `readiness.ts`'s Optionomics checks
   already refuse to for that same reason).
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

## What this document does not do

It does not implement any code. It does not assume a specific Alpaca OAuth endpoint
shape — that must be confirmed against Alpaca's actual current API documentation at
implementation time (the same "never guess an undocumented endpoint" discipline
`readiness.ts` already applies to Optionomics). Building this without that
verification step would risk exactly the kind of fabricated-capability mistake this
whole engagement has consistently avoided.

## Status

SPECIFIED. `BLOCKED_BY_CONFIGURATION` until implemented and until Alpaca's actual
current customer-authorization API contract is confirmed.
