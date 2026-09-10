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
