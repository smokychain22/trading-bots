# Owner/Operator Console — Information Architecture

Specification and current foundation for the private `/ops` console. It never appears
in customer navigation. The current release uses a temporary shared operator secret
to create a signed, 15-minute, HttpOnly session. Proper owner IAM is still required
before this can be considered a complete production administration system.

## Top-level sections

1. **Overview** — operating mode (OFF/SHADOW/PAPER/LIVE_SMALL/LIVE — only PAPER
   architecture may ever be *active* today, per this takeover's standing constraint),
   operational override (RUN/PAUSE_NEW_ENTRIES/SAFE_HOLD/QUARANTINE/KILL, each change
   requiring actor/time/reason/old-state/new-state/version per the existing AEGIS exit-
   supremacy discipline), worker heartbeat, last/next scan, last decision, last trade,
   open positions/orders, pending intents, `UNKNOWN_SUBMISSION` count, AEGIS state,
   broker state, provider state, current economic P&L/drawdown/capital utilization.
2. **Opportunity Engine** — the full `opportunity_frontier.py` output surfaced
   directly: eligible underlyings scanned, contracts evaluated, positive-EV/WAIT/PASS/
   AEGIS-rejected/execution-rejected/Q=0 counts, the ranked actionable book (rank,
   underlying, structure, DTE, strike, `EV_net`, tail-adjusted economics, capital
   required, `ReturnPerCapitalDay`, uncertainty, AEGIS state, quantity, action), and
   per-WAIT detail (required change, next recheck, expiration). This is the
   `GlobalIdleReport`/`OpportunityBookEntry` data already modeled in
   `bots/theta/quant/models/opportunity_frontier.py`, surfaced rather than duplicated.
3. **Decision Frontier** — for any evaluated state, every valid competing action's
   utility (`ManagementDecision.valuations` from `management_action_value.py`),
   selected action, runner-up, `hold_advantage()`, economic/risk difference, reason
   codes, policy/model version, snapshot reference.
4. **Master Alpaca PAPER** — connection status, PAPER-only assertion, account
   equity/cash/buying power/options level, market status, positions/orders/fills/
   activities, last REST reconciliation, `trade_updates` health, quote health, contract/
   Greeks capability, corporate-action state, latency, provider degradation. Built
   directly from the existing `checkAlpaca` readiness output
   (`src/providers/readiness.ts`) — never credentials themselves.
5. **Execution** — order intents, `client_order_id`, broker order id, submitted
   limit, bid/ask at decision, fill, slippage, partial fills, reprices, cancels,
   rejections, ambiguous submissions, reconciliation state, markouts. Highlights
   `UNKNOWN_SUBMISSION`/`PARTIAL_FILL`/`BROKER_MISMATCH`/`STALE_QUOTE`/
   `RECONCILIATION_REQUIRED`.
6. **Reconciliation** — CLEAN/PENDING/MISMATCH/QUARANTINED states (R2 design),
   broker-vs-internal-expected-state comparison.
7. **Economic Ledger** — the complete Wheel chain lineage (CSP → roll → CSP →
   assignment → stock → recovery → CC → call-away/exit), with realized/unrealized
   option and stock P&L, dividends, fees, slippage, `WholeChainPnL`, `CapitalDays` —
   never hiding an open stock loss (this is the one place inventory losses are shown
   with maximum, not minimum, visibility — the customer side shows the same truth in
   plain language, per `CUSTOMER_VS_ADMIN_INFORMATION_BOUNDARY.md`).
8. **Copy Engine** — followers connected/actively copying, allocated capital,
   eligible followers, master decisions, copy intents, follower orders/fills/skips,
   Q=0 followers, copy latency, execution degradation, tracking error, capacity, failed
   copies — investigable per-follower without exposing one tenant's data while viewing
   another's (server-side scoping, not a UI toggle).
9. **Models / Research** — strategy/policy/model versions per family (ownership,
   regime, entry, management, assignment, recovery, CC, roll, AEGIS, sizing,
   execution), research status (baseline/challenger/shadow/validated/rejected per
   `docs/quant/phase2/MODEL_REGISTRY.md`'s existing governance table), expert-DNA/
   failure-DNA/hypotheses/ablations/walk-forward/OOS/TCA/calibration — this is where
   everything in `docs/quant/` becomes an operator-facing live view, never customer-
   facing.
10. **Incidents** — worker offline, provider stale, broker/ledger mismatch,
    reconciliation failure, unknown order, stuck partial fill, assignment/expiry/
    corporate-action anomalies, AEGIS veto, abnormal drawdown, follower failure, large
    tracking error, unexpected/missing position — severity, affected scope, detected
    time, safe state, resolution, audit history.
11. **System Health** — Alpaca/Optionomics/PostgreSQL/Redis/worker/web-API provider
    states (GOOD/DEGRADED/UNKNOWN/INVALID/NOT_ENTITLED), last successful response,
    latency, freshness, error count, last incident.
12. **Audit** — every operator state change (actor/time/reason/old/new/version) —
    no anonymous destructive control.

## Route and access

The canonical route is `/ops`. An unauthenticated request redirects to `/ops/login`.
No customer page or navigation element links to either route.

Current owner access procedure:

1. Open `/ops/login` on the deployed trading-bots domain.
2. Enter the operator access key held in the authorized secret store and configured
   server-side as `THETA_READINESS_TOKEN`. Never paste this value into source code,
   issue text, chat logs, or browser storage.
3. Select **Open operations**. The server checks the key using a timing-safe
   comparison, returns a signed Secure, HttpOnly, SameSite=Strict cookie, and redirects
   to `/ops`.
4. The session expires after 15 minutes. Select **Sign out** to invalidate it sooner.

The shared-secret login is temporary. It has no per-user identity, MFA, role model,
revocation list, or durable operator audit identity. Replace it with owner IAM before
any operator mutation or broader team access is released.

## Status

FOUNDATION IMPLEMENTED. `/ops` now provides read-only runtime, provider, decision,
execution, economic-record, copy-engine, infrastructure, release-gate, and incident
visibility. Most runtime values correctly remain `UNKNOWN` or `BLOCKED` until their
persistent services exist. Provider verification is read-only. No trading mutation is
exposed. The full tabbed console, owner IAM, persistent audit log, incident workflows,
and runtime-backed metrics remain future work.
