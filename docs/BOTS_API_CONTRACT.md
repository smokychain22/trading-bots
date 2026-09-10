# Customer API contract, v1

Handler: src/customer/api.ts. Vercel entry: api/customer.ts. Vercel binds the repeated public path to the single route query without retaining the repetition marker in the destination. Local development uses the same handler through src/app.ts. All responses are JSON and no-store.

## Public reads

GET /api/v1/bots returns the six public summaries.

GET /api/v1/bots/{bot} returns BotDetail.

Section endpoints: /status, /performance, /equity, /positions, /history, /risk, /intelligence, /activity and /chains. A chain can be addressed as /chains/{id}.

Response envelope: api_version = v1, dataset = published or demo, data = the requested projection. Detail endpoints also return an evidence summary. The default is published. Explicit ?dataset=demo opts into THETA's deterministic illustration. Roadmap bots never gain invented demo performance. Unknown dataset is 400, missing bot/resource is 404, unsupported method is 405.

These public bot-read endpoints do not connect to a broker, submit an order, or enable
a bot. No public payload contains private account data. They are unauthenticated public
product records only. User-specific records require server-side tenant authorization.

## Paper-copy preparation

GET /api/v1/copy/readiness returns customer-scoped PAPER connection, allocation, and
execution-lock state. It resolves identity from the server session. A caller cannot
choose a customer id.

GET /api/v1/copy/results returns an empty follower-only projection until customer
identity and account tenancy exist. It never substitutes the master PAPER account's
performance for customer results.

POST /api/v1/copy/policy/validate validates the full paper policy contract. It returns
final_quantity=0 because follower preflight sizing has not run. It can mark the draft
ready to save only when the authenticated follower account passed broker readiness.

POST /api/v1/copy/participation persists the authenticated customer's allocation and
a versioned follower policy. It returns order_submission=LOCKED. It does not activate
a worker or submit an order.

## Customer identity and Alpaca Connect

POST /api/v1/auth/register and POST /api/v1/auth/login create an opaque, hashed,
database-backed customer session in an HttpOnly cookie. GET /api/v1/auth/session reads
the current identity projection. DELETE /api/v1/auth/session revokes the session.
State-changing calls require same-origin requests.

GET /api/v1/alpaca/oauth/start requires a customer session and redirects to Alpaca's
documented authorization-code flow with env=paper. GET
/api/v1/alpaca/oauth/callback atomically consumes the customer-bound, ten-minute OAuth
state, exchanges the code server-side, verifies the PAPER account through read-only
account, positions, and open-orders requests, and stores only AES-256-GCM ciphertext.
The token is never returned to the browser. DELETE /api/v1/alpaca/connection revokes
the stored ciphertext and disconnects the follower without liquidating any position.

POST /api/v1/alpaca/connection/verify decrypts the authenticated customer's stored
token server-side, reruns read-only PAPER account checks, and updates the last verified
state. The response contains only masked account and safe readiness fields. It never
returns the token and never submits an order.

The OAuth routes fail closed when DATABASE_URL, Alpaca Connect credentials, callback,
or encryption-key configuration is absent. No raw-key customer connection is
supported.

## Capital scenario

POST /api/v1/bots/theta/simulate accepts strict numeric inputs:

capital, strike, premium, stock_at_exit, max_contracts, costs_per_contract, dte, min_dte, max_dte, max_daily_loss, max_slippage, min_open_interest and join_existing=false.

Finite bounds and cross-field checks reject invalid values. DTE excludes zero. Quantity is min(max_contracts, floor(capital / (strike * 100 + costs_per_contract))), or zero outside the user's DTE range. Premium is not added to available collateral.

Economic P&L = opening premium + assigned-stock MTM - modeled costs. Assignment below strike is a simplified expiry assumption, not a probability model. At zero quantity there is no assignment. No covered call or roll is assumed.

Output is always DEMO_DATA and execution_authorized=false. Daily loss, liquidity and slippage preferences are recorded but not enforced. This endpoint is a calculator, not a backtest or full trading simulator.

Invalid or oversized bodies return a generic 400 without echoing input. The body limit is 12,000 characters after parsing, while the host applies its own transport limits. Both raw Express streams and Vercel pre-parsed bodies are supported.

## Private owner access

POST /api/v1/operator/session exchanges an existing strong operator credential for a 15-minute HMAC-signed HttpOnly, Secure, SameSite=Strict cookie scoped to the site path so the protected `/ops/*` pages and operator APIs can use the same session. State-changing session calls require same-origin headers. Missing or incorrect credentials return 401. No credentials are stored in localStorage.

GET /api/v1/operator/status requires a valid session and returns release visibility only. It reports current provider runtime as UNKNOWN, not as a continuously refreshed health result. DELETE /api/v1/operator/session clears the browser cookie.

POST /api/v1/operator/master-readiness, POST
/api/v1/operator/optionomics-readiness, POST
/api/v1/operator/database-readiness, and the compatibility POST
/api/v1/operator/provider-readiness require the operator session. They issue only
documented read-only provider requests and return safe capability state, operation
alias, HTTP status, timestamps, masked account identity, and numeric account fields.
They never return a credential or authorization header and never submit an order.

The database readiness response states whether PostgreSQL is missing, connected,
degraded, or needs migrations. Runtime connections are transaction-pooled. Migrations
must use a direct or session-pooled URL so session-level migration behavior is safe.

No trading, secret, deployment or account mutation is exposed. Stateless session logout removes the browser cookie, while an already stolen cookie remains valid until expiry or operator-key rotation. This small operator surface is not a customer IAM system. Individual accounts, MFA, centralized revocation and durable rate limiting remain requirements before expanding privileged functions.

## Deployment

Vercel rewrites customer URLs to the single serverless handler and page URLs to the static shell. The static app uses same-origin fetches and external ES modules under a restrictive CSP. Root and deep-link behavior are checked after deployment. Production website status remains independent from PAPER broker configuration and disabled trading.
