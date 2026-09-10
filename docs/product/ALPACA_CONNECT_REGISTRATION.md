# Alpaca Connect registration package

This is the owner-ready registration content for THETA's customer PAPER connection.
It does not authorize LIVE trading and it does not enable order submission.

## Application fields

- Application name: `THETA Paper Copy by Trading Bots`
- Callback URL: `https://trading-bots-one.vercel.app/api/v1/alpaca/oauth/callback`
- Environment: PAPER, requested with `env=paper`
- OAuth scope: `trading`
- Website: `https://trading-bots-one.vercel.app`
- Recommended description: `A PAPER-only automated options strategy and copy-trading application. It connects authorized Alpaca paper accounts, verifies account readiness, saves user-controlled paper capital allocation, and prepares follower-specific execution. Broker order submission is currently disabled.`

The product must disclose that it uses Alpaca and must not imply that Alpaca built or
endorsed it. Submit the commercial application for Alpaca's written approval before
opening customer account connection broadly.

## Current implementation status

- Authorization-code OAuth is implemented server-side.
- The callback and token exchange are server-side.
- State is customer-bound, hashed, single-use, and expires after ten minutes.
- Tokens use AES-256-GCM and are never returned to the browser.
- Re-verification uses the stored encrypted token and only read-only requests.
- Options level 1 is sufficient for THETA's covered-call and cash-secured-put scope.
- Level 0 is blocked. Levels 1, 2, and 3 are eligible for the core strategy.
- Customer raw-key connection is structurally unavailable.
- PAPER order submission remains locked.

## External owner actions still required

1. Submit or complete the Alpaca Connect commercial application review.
2. Register the exact callback above.
3. Add the issued client id and client secret to Vercel Production.
4. Provision PostgreSQL and apply migrations through `007_connection_readiness`.
5. Configure the encryption key and key reference in Vercel Production.
6. Run a real OAuth browser connection and re-verification test after deployment.

Official references checked on 2026-09-10:

- https://docs.alpaca.markets/us/docs/about-connect-api
- https://docs.alpaca.markets/us/docs/registering-your-app
- https://docs.alpaca.markets/us/docs/using-oauth2-and-trading-api
- https://docs.alpaca.markets/us/v1.1/docs/options-trading
