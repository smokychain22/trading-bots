# Customer API contract, v1

Handler: src/customer/api.ts. Vercel entry: api/customer.ts. Vercel binds the repeated public path to the single route query without retaining the repetition marker in the destination. Local development uses the same handler through src/app.ts. All responses are JSON and no-store.

## Public reads

GET /api/v1/bots returns the six public summaries.

GET /api/v1/bots/{bot} returns BotDetail.

Section endpoints: /status, /performance, /equity, /positions, /history, /risk, /intelligence, /activity and /chains. A chain can be addressed as /chains/{id}.

Response envelope: api_version = v1, dataset = published or demo, data = the requested projection. Detail endpoints also return an evidence summary. The default is published. Explicit ?dataset=demo opts into THETA's deterministic illustration. Roadmap bots never gain invented demo performance. Unknown dataset is 400, missing bot/resource is 404, unsupported method is 405.

No endpoint connects to a broker, submits an order or enables a bot. No public payload contains private account data. These are unauthenticated public product records only. User-specific records must not be added without tenant authorization.

## Capital scenario

POST /api/v1/bots/theta/simulate accepts strict numeric inputs:

capital, strike, premium, stock_at_exit, max_contracts, costs_per_contract, dte, min_dte, max_dte, max_daily_loss, max_slippage, min_open_interest and join_existing=false.

Finite bounds and cross-field checks reject invalid values. DTE excludes zero. Quantity is min(max_contracts, floor(capital / (strike * 100 + costs_per_contract))), or zero outside the user's DTE range. Premium is not added to available collateral.

Economic P&L = opening premium + assigned-stock MTM - modeled costs. Assignment below strike is a simplified expiry assumption, not a probability model. At zero quantity there is no assignment. No covered call or roll is assumed.

Output is always DEMO_DATA and execution_authorized=false. Daily loss, liquidity and slippage preferences are recorded but not enforced. This endpoint is a calculator, not a backtest or full trading simulator.

Invalid or oversized bodies return a generic 400 without echoing input. The body limit is 12,000 characters after parsing, while the host applies its own transport limits. Both raw Express streams and Vercel pre-parsed bodies are supported.

## Private owner access

POST /api/v1/operator/session exchanges an existing strong operator credential for a 15-minute HMAC-signed HttpOnly, Secure, SameSite=Strict cookie scoped to /api/v1/operator. State-changing session calls require same-origin headers. Missing or incorrect credentials return 401. No credentials are stored in localStorage.

GET /api/v1/operator/status requires a valid session and returns release visibility only. It reports current provider runtime as UNKNOWN, not as a continuously refreshed health result. DELETE /api/v1/operator/session clears the browser cookie.

No trading, secret, deployment or account mutation is exposed. Stateless session logout removes the browser cookie, while an already stolen cookie remains valid until expiry or operator-key rotation. This small operator surface is not a customer IAM system. Individual accounts, MFA, centralized revocation and durable rate limiting remain requirements before expanding privileged functions.

## Deployment

Vercel rewrites customer URLs to the single serverless handler and page URLs to the static shell. The static app uses same-origin fetches and external ES modules under a restrictive CSP. Root and deep-link behavior are checked after deployment. Production website status remains independent from PAPER broker configuration and disabled trading.
