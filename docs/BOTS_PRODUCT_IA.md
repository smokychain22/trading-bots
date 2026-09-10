# Standalone product information architecture

Authority: the owner's standalone Phase 1 request, 2026-09-09. This supersedes previous assumptions that this site is only a TradePilot reference implementation. TradePilot is untouched.

## Customer navigation

| Area     | Route                    | Purpose                                                               |
| -------- | ------------------------ | --------------------------------------------------------------------- |
| Home     | / and /overview           | State-driven account and THETA copy starting point                    |
| Bots     | /bots                     | THETA exploration first, followed by a quieter research roadmap       |
| My Bots  | /my-bots                  | Copy participation, allocation, follower status, and stop semantics   |
| Activity | /activity                 | Customer-readable follower and bot events with drill-down             |
| Account  | /account                  | Alpaca PAPER connection, account facts, and disconnect warning        |
| Learn    | /bots/theta/how-it-works | Accessible Wheel explanation and disclosures                          |
| Compare  | /compare                 | Contextual roadmap comparison, not a primary navigation destination   |
| Owner    | /ops                     | Direct authenticated operator route, not customer navigation          |

THETA's customer navigation is Overview, My Results, Positions, Trade History, and
Performance. My Results is follower-only. Performance is the master THETA record.
How It Works is available as About THETA without crowding the primary tab set.
Simulation remains at /bots/theta/simulate. Chains use /bots/theta/chains/{id}.

## Progressive disclosure

Level one: identity, current release state, latest decision, strategy intent, risk uncertainty, capital uncertainty and primary economic KPIs. Level two: chart, positions, lifecycle, activity and track-record inclusion flags. Level three: calibration, independent sample size, recovery, stress, execution and advanced accounting detail.

## Differentiation pattern: decision receipts

The reusable customer-facing Decision Receipt answers action, plain-English reason, capital affected, AEGIS result, provenance and freshness before offering technical detail. It appears first on THETA overview and is echoed in activity, history and lifecycle detail. A model estimate remains an estimate and DEMO DATA remains visibly synthetic.

Material stock losses are never collapsed out of headline economics. Missing evidence is itself material and remains visible.

## Primary journeys

Discovery to understanding: filter owned bots, open THETA, inspect risk and How It Works, inspect provenance.

Understanding to copy setup: connect an Alpaca PAPER account, choose an allocation,
then review and start. The current release stops honestly before connection or
activation because customer IAM and OAuth ownership are not available.

Understanding to illustration: explicitly enter demo record mode or the capital
scenario. Change capital, contract and cost assumptions. See zero-size or
assignment-loss results.

Investigation: open a position, follow its chain, expand accounting and decision details, compare premium with whole-chain P&L.

Owner: enter an existing operator credential, inspect Overview, THETA, Trading,
Copy, and System through a short-lived secure session, then sign out. No order or
configuration mutation is exposed.

## Availability rules

THETA is a PAPER-environment development project with automation not enabled. It has no published customer performance feed. ATLAS, NEXUS, VEGA, EVENT and PULSE are RESEARCH, COMING LATER and NOT AVAILABLE. The website can be deployed in production while trading stays disabled.

Copy controls are a clearly labeled preference foundation. No customer account is connected, capital is not allocated, daily loss preferences are not enforced, and existing positions cannot be joined. Customer identity, subscriptions, broker authorization and copy reconciliation are release gates beyond this UX phase.

## Definition of done and boundaries

All named routes render, API contracts are versioned, demo provenance is persistent, empty/error states are useful, responsive and automated accessibility checks pass, references are captured, root returns 200, and tested main passes CI. No quant-model rewrite, new provider, strategy calibration, live orders or TradePilot coupling is part of this work.
