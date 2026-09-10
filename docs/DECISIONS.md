# Engineering decisions

## 2026-09-09: standalone customer platform

The owner's latest instruction makes trading-bots a complete standalone website for the current development period. TradePilot integration is deferred. UI components and versioned public projections remain separate from the trading engine.

## 2026-09-09: preserve the working stack

Keep Node/TypeScript, Express and Vercel. Use static HTML, CSS and native ES modules for this small read-oriented interface. No new frontend framework or strategy rewrite is justified. Playwright and axe are development-only dependencies for browser, viewport and accessibility verification.

## 2026-09-09: honest data before customer claims

The published dataset contains truthful unavailable states. Illustrative performance is opt-in, deterministic and labeled DEMO DATA. No customer performance publisher, calibrated risk classification or minimum viable capital is invented. RESEARCH provenance is added for future bots without a backtest.

## 2026-09-09: simulation scope

Implement an educational cash-secured-put capital scenario, not an execution engine or historical simulator. Preferences prepare a future copy UX but remain unenforced and visibly unavailable for activation. Quantity zero is valid. The scenario has no broker calls.

## 2026-09-09: private owner surface

Reuse the existing operator credential for short-lived secure read-only sessions. Do not introduce a new secret or expose operational responses publicly. Full IAM, MFA, durable sessions and account-scoped copy controls are separate release work.

## 2026-09-09: deployment and coordination

Work in codex/standalone-platform from main b495436, preserve Claude's quant modules and the separate worktrees. The baseline production root already returns 200. An earlier missing-public-output failure was historical, so no unchanged broken redeploy is attempted. Explicit rewrites and CSP support the new standalone pages.

The owner's later authority permits tested main pushes, superseding earlier no-push language. Fetch and inspect overlap before integration. Never force-push.

## 2026-09-10: Phase 1.5 customer reconstruction

Keep every financial and provenance contract intact while simplifying the customer surface. Primary navigation is Overview, Bots, My Bots and Activity. Compare becomes contextual, while owner access remains a direct authenticated operator route. THETA receives a decision-first overview, an explicit available-for-exploration hierarchy, compact detail navigation and a progressive-disclosure simulation. Research bot cards remain available as a quiet roadmap only.

## 2026-09-10: automatic follower-copy authority boundary

THETA owns strategy and lifecycle decisions. Customers control account connection,
paper-capital allocation, stopping new entries, and disconnection. There are no
per-trade approvals or customer strategy overrides. Stop New Copies blocks new
entries while existing copied positions remain under THETA management. Disconnect
stops management and does not liquidate positions automatically.

The first copy-engine milestone is deterministic and non-executing. Stable copy
event and client order identifiers, follower-specific sizing, valid quantity zero,
partial-fill handling, and reconciliation-before-retry are implemented as contracts
and persistence constraints. Broker submission stays disabled until customer IAM,
OAuth state ownership, encrypted token references, runtime adapters, and PAPER chaos
tests are complete.

## 2026-09-10: split customer and owner information architecture

Customer navigation is Home, Bots, My Bots, Activity, and Account. THETA distinguishes
master strategy Performance from follower My Results. Customer position and history
views are read-only. The private owner surface uses five protected routes: Overview,
THETA, Trading, Copy, and System. The temporary shared operator token remains a
short-lived session bridge, not production IAM.

## 2026-09-10: separate master and follower Alpaca trust domains

The THETA master PAPER account continues to use deployment-managed Alpaca key and
secret references. Customer accounts use Alpaca Connect authorization-code OAuth with
env=paper. Customer raw keys are never accepted. OAuth state is random, hashed,
customer-bound, single-use, and expires after ten minutes. Access tokens use
AES-256-GCM with customer identity as authenticated data and remain server-side.

Customer identity uses a stable PostgreSQL UUID, salted scrypt password verification,
opaque hashed sessions, server-side tenant filters, and revocable HttpOnly cookies.
This first-party beta identity layer still needs rate limiting, verified email,
recovery, MFA, and security operations before a broad public release.

Saving a follower allocation creates a durable policy and READY participation record.
It does not mean COPYING or ACTIVE. The existing copy-event and follower-order-intent
contracts remain non-executing, and execution_authorized stays false.

## 2026-09-10: integrate Claude R1 without false runtime claims

Selected Claude R1 runtime contracts, provider input adapters, opportunity assembly,
hard gates, and decision assembly were integrated without replacing the current
customer UI or copy persistence. THETA remains
R1_INTEGRATED_INPUT_ASSEMBLY_BLOCKED. A production scheduler, real ownership, regime,
and event input assembly, plus persisted shadow decision receipts are required before
the owner UI may show SHADOW RUNNING.

The standalone Alpaca provider adapter, pagination, universe policy, point-in-time
features, and freshness gates passed integration review and were kept. The proposed
one-shot shadow runner was not merged because it still contains synthetic operational
defaults, converts a missing entry bid to zero, lacks live Optionomics and event-state
inputs, and does not persist receipts. Those are correctness blockers, not reasons to
label a partial cycle as running.
