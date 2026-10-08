# Isolated Dot Strategy Lab

## Authority

This implementation is an isolated, disabled-execution interface over THETA readers, strategy registry, T0 sovereign replay and portfolio-capital arithmetic. It constructs no broker mutation client, order coordinator or trading worker. It is not mounted into the Production HTTP app. No Production migration, execution control or resident-worker configuration is changed.

The confirmed broker identity is pinned by exact provider UUID in a private identity file. A separate account-scoped SQLite WAL store rejects a changed provider, execution or workspace identity on restart. Generated execution/workspace IDs are lab namespaces, not registered PostgreSQL trading accounts. The account selected previously in a dashboard is not a substitute for the currently pinned authenticated account.

## Private runtime

`src/lab/main.ts` accepts explicit absolute private credential, identity, token and state paths. It never inherits THETA credentials or a database URL. Files inside the repository are refused, including symlink destinations. The credential file contains `ALPACA_API_KEY`, `ALPACA_SECRET_KEY` and the exact Paper base URL. Keep credentials and data in a protected Windows directory outside Git and exclude it from secret-exposing backups.

`--verify-only` performs sequential canonical GET account, positions, open orders, market clock and account identity recheck, then persists an observation and closes the local store. The normal server binds only to loopback and requires distinct reader/proposer access tokens. Tokens, account identifiers, identity files and SQLite state must never be committed. The private directory's ACL must restrict access to its owner and SYSTEM. Administrators and privileged backup software are outside an ACL's guarantees.

Reads are host-pinned to Alpaca Paper and market-data origins, physically GET-only, deadline-bounded by the existing provider, and reject redirects. Pagination completeness and unavailable quote fields remain explicit. Raw snapshots are not certified executable prices. Contracts/market requests are bounded to two pages and a 90-day expiry window.

## Interfaces

- Reader routes provide account, observation, canonical source strategies, bounded contracts/market snapshots, proposals, experiments, private export and explicit unavailable performance state.
- Proposer scope adds immutable versioned draft submission. Drafts preserve the exact baseline hard rules and risk references. They remain `RESEARCH_ONLY`, `UNVALIDATED` and non-executable.
- `/mcp` and the private `--stdio` runner share tested JSON-RPC initialize, tool discovery and read-only calls. Tools expose no order submission, SQL execution, arbitrary URL or strategy activation. Stdio has bounded input, serial calls and no credential or status logging on its protocol output. It is for an owner-controlled private tunnel process, not a public unauthenticated endpoint.
- Private export includes hashes and account-scoped observations. Source SHA remains null/unverified unless explicitly supplied to the export function. A supplied SHA is not deployed-worker proof.
- Feedback schema carries decisions, rejected opportunities, order/fill/chain references, fees, prices, capital-days, P&L, labels and truth classes. Unknown fees and unresolved outcomes cannot become resolved results. Caller-labeled broker rows cannot certify performance before the canonical ledger importer is wired.
- Synthetic feedback export accepts only `MODELED_RESEARCH`. Performance aggregation reuses THETA's existing analytics and cannot promote a modeled result.

Storage stops rather than deleting evidence when its 2,000-row or 16 MiB payload budget is reached. Individual payloads are limited to 256 KiB. SQLite's 8,192-page ceiling is 32 MiB for a new default-page-size database, with frequent WAL checkpoints. Long external readers can delay WAL truncation, so this is bounded metadata storage, not a high-frequency warehouse.

## Experiment boundary

`runDotBaselineReplay` validates immutable proposal identity, sealed T0, account namespace, current modeled envelope/quote times and canonical quantity. It calls THETA's sovereign replay and capital admission, then persists an idempotent `MODELED_RESEARCH` receipt. It does not apply challenger rules or create an intent. Those facts and the remaining rule-consumer/account-envelope/authorization gates are explicit in every receipt.

The existing real disposable-PostgreSQL tests cover canonical shared-capital concurrency and reconciliation. They do not certify a registered Dot runtime, approved challenger, Paper intent, fill, management or close. An automatic Paper experiment remains unready until those existing canonical integration boundaries are wired and governed release approval is granted.

## Cloud connection gate

Dot is the existing cloud agent. The local token-authenticated interface is tested locally, not yet connected to Dot. GitHub is only the public-safe proposal exchange.

[OpenAI plugin authentication documentation](https://developers.openai.com/plugins/build/auth) describes OAuth for private custom MCP access. ChatGPT does not send custom API-key headers, so the local bearer token cannot be treated as completed cloud account linking.

[Secure MCP tunnels](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) support an outbound connection from a private environment, but require a provisioned tunnel, matching workspace permissions and runtime credentials. Alternatively an HTTPS MCP endpoint needs governed hosting and OAuth. No tunnel, public endpoint, OAuth provider or cloud connector was provisioned here. A successful tool invocation from Dot against the pinned account is the final access proof.

## Next gates

1. Owner approval to push this tested review-branch checkpoint. No merge or deployment implied.
2. Verify Dot's GitHub repository read and proposal handoff.
3. Owner/workspace connection capability for private MCP, authenticated linking, then an actual Dot read.
4. Canonical account-scoped ledger importer, challenger-consumer integration, management contract and shared reservation-to-intent wiring in an isolated lab runtime.
5. Governed release and separate experiment authorization before any Paper order. Live money remains unauthorized.

## Review continuation after foundation CI

Foundation `fd144cc333c38e658c8c77fed1afbcaa1b345ea8` passed exact-SHA CI run `37804755324`. This certifies source tests, not a Dot cloud connection, deployment or Paper experiment.

`src/lab/proposal-consumer.ts` connects validated H/D drafts to the existing research generators. Implemented configuration changes are bounded DTE narrowing and point-in-time numeric research rules. Evidence must match the decision snapshot and source evidence IDs, be available before the decision, and remain valid. Missing, stale, unqualified or future data block evaluation. Changed model references, delta buckets, option type, action sets or unsupported lattice expansion remain explicit blockers. Q and stock-inventory branches still require their canonical consumer integration. Registry defaults and Production selection remain unchanged.

`persistDotExitComparison` uses the existing full 17-policy offline profit-taking replay with the proposed elapsed holding horizon. It retains every policy trial and explicitly marks estimated exits as modeled, never actual fills or empirical promotion. This is separate from authorizing a Production management rule.

`src/lab/ledger-import.ts` reads one bounded repeatable-read, read-only canonical snapshot. It verifies the registered execution account's Paper environment and exact provider UUID hash, rejects mixed-account chains, and exposes account-scoped orders, fills, option legs, stock, fee events, dividends, assignment reconciliation and whole-chain resolutions. Unknown fees or unmatched fill/ledger fees remain unresolved. It reuses `resolveWholeChainOutcome`. Current ledger reads cannot be presented as historical PIT or fresh broker reconciliation. Reader SHA is source metadata, not deployment proof.

The gateway rechecks the pinned broker account before and after the ledger read, then stores only a complete bounded private receipt. `/v1/ledger` and `dot_ledger` expose this through the existing authenticated read-only interface. A missing reader fails explicitly. `--ledger-config` accepts an explicit private configuration outside Git, with matching account IDs, reader SHA and an isolated loopback PostgreSQL URL. It creates one read-only pool of size one. It rejects remote hosts and URL query overrides. It never falls back to Production credentials. No real lab ledger was registered or configured by this checkpoint.

The disposable PostgreSQL test uses rolled-back synthetic fixture facts and a transaction-to-savepoint adapter. It proves the actual SQL joins, fee handling and mixed-account rejection. Ordinary read-only transaction and release/error semantics are separately tested. Neither test is natural Dot broker lifecycle evidence.

Cloud admission still needs the supported Secure MCP Tunnel provisioned for the correct OpenAI organization and ChatGPT workspace, authenticated runtime permission, enabled plugin, and an actual read from Dot. The checked local environment has no tunnel client or runtime control-plane credential. No direct Dot/tunnel provisioning tool was exposed. GitHub plugin inventory reports the plugin available but not installed. Local stdio tests are not cloud proof.
