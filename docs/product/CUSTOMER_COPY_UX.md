# Customer Copy-Trading UX Specification

Specification correcting the product direction from a research/educational site to an
autonomous copy-trading platform. Not yet implemented (priority order: R1-R4 runtime
first). This document is the target design future UI work must match — it does not
change any existing UI code.

## Language correction (audit target, not yet applied)

Remove/demote from customer-facing copy: "Explore THETA," "Available for exploration,"
"Exploration only," "Research pipeline," "What comes later," "Explore an illustrated
record," "Understand THETA," "Compare roadmap." These describe a documentation site,
not a trading product. Research/validation status may still be shown honestly
(`docs/quant/`'s maturity labels — SPECIFIED/IMPLEMENTED/BLOCKED_BY_DATA — already give
the vocabulary for this), but it must never be the product's primary identity.

Replace with plain operational states:
- **Bot status:** Preparing / Ready / Running / Paused / Managing position / Waiting
  for opportunity / Broker disconnected / System issue.
- **Copy status:** Not connected / Setup required / Ready to copy / Copying / Paused /
  Stopped.

Every one of these must reflect genuine backend state — never fabricated to look more
active than the runtime actually is (a direct restatement of this whole engagement's
anti-fabrication discipline, applied to UI copy specifically).

## Navigation (target, simplified from current state)

Top level: **Home, Bots, My Bots, Activity, Account** (+ notifications/profile in
header). Remove **Compare** as a primary nav item until multiple bots have real
validated records — it has nothing honest to compare yet. Remove **Understand THETA**
and **Compare roadmap** from permanent sidebar nav; educational content moves
contextual/under Help.

## Bots page

A copy-trading catalog, not a strategy showcase. THETA's card: name, one-line
strategy description, PAPER badge, bot state, and **only-if-real** 30D P&L/all-time
P&L/WR/PF/max DD — when no track record exists, one line ("Track record building"),
never fabricated numbers or seven empty panels. Primary CTA: **View THETA**, becoming
**Copy THETA** once the backend genuinely supports it. Future bots (ATLAS/NEXUS/VEGA/
EVENT/PULSE) show only "IN DEVELOPMENT," no fake metrics, no long descriptions.

## THETA overview page

Must answer within 5-10 seconds: is it running, what's it doing now, is my account
copying it, allocation, P&L, positions, latest action, current risk. A compact
operational header (bot state, copy state, primary action button whose label depends
on real state: Connect Paper Account / Set Up Copying / Start Copying / Manage Copy /
Pause Copy) — never "Explore THETA."

## Allocation ("Simulate capital" renamed)

Before connection: "Preview Copy Size" or "See How Copying Works." After connection:
"Set Allocation," with only the plain inputs listed in
`docs/product/COPY_THETA_FLOW.md` step 2 — no delta/DTE/IV/Greeks/regime exposed to
ordinary users.

## My Bots

The user's command center: per copied bot — status, connected account, allocated/
used capital, current P&L, open positions, today's activity, last action, copy
health, and View/Manage/Pause/Stop controls. No strategy internals exposed (per
`CUSTOMER_VS_ADMIN_INFORMATION_BOUNDARY.md`).

## Activity

Plain-language, causally clear entries — including *why* follower behavior diverged
from master ("Your account did not copy the trade. Reason: your available allocation
supported 0 contracts." / "Trade skipped. Reason: your option spread was too wide.").
A skip is explicitly framed as correct behavior, never an error.

## Performance

One concise empty state when no track record exists — never multiple giant blank
panels. Once real data exists: Economic P&L, Return %, Managed Episode WR, PF, Max DD,
Open Inventory MTM, equity curve, monthly returns, resolved episodes, AvgWin/AvgLoss,
payoff ratio, assignment rate, recovery duration up front; ES/CVaR, effective N, Brier,
LogLoss, slippage, capital-days under a collapsed "Advanced statistics" section. No
raw model formulas ever shown to a customer.

## Positions

Compact empty state when nothing is open. When active: underlying, lifecycle state
(CSP/Stock/CC), quantity, entry, current value, economic P&L (broken into premium
collected / stock MTM / costs — an assigned-stock loss is always visible, never
folded into a single number that hides it), DTE, next event, current bot status/next
review time.

## Trades (renamed from "Trade History")

Lifecycle-aware entries (open/close/roll), with a roll always showing the old leg's
realized result and the new leg's separately — **a roll never visually erases a
loss**, consistent with the platform-wide roll-immutability rule already enforced in
the quant layer (`FORMULA_REGISTRY.md`'s `WholeChainPnL` discipline). Full chain
expansion available.

## Copy THETA setup

See `docs/product/COPY_THETA_FLOW.md` for the five-step wizard.

## Strategy transparency (plain language only)

Customers learn: THETA sells premium; assignment may occur; assigned stock remains
part of P&L; THETA may wait before selling a covered call; THETA can close, roll,
accept assignment, recover, and allow call-away. They do not receive private
formulas, expert-DNA specifics, model thresholds, feature weights, or proprietary
candidate rankings — see `docs/product/CUSTOMER_VS_ADMIN_INFORMATION_BOUNDARY.md` for
the exact line.

## Design philosophy

Institutional fintech, not casino/social-marketplace styling — no neon P&L, no
confetti, no "guaranteed"/"AI says 98%," no hidden losses. Clear hierarchy, large
meaningful numbers, minimal navigation, plain English, compact tables, strong status
indicators, progressive disclosure, real empty/loading/degraded/error states, mobile
responsiveness.

## Status

SPECIFIED. No UI code changed by this document — per the product correction's own
priority order, this is prepared now and implemented once R1-R4 runtime work provides
the real state this design depends on rendering truthfully.
