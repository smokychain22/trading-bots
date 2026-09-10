# Standalone product information architecture

Authority: the owner's standalone Phase 1 request, 2026-09-09. This supersedes previous assumptions that this site is only a TradePilot reference implementation. TradePilot is untouched.

## Customer navigation

| Area     | Route                    | Purpose                                                               |
| -------- | ------------------------ | --------------------------------------------------------------------- |
| Overview | /overview                | Strategy introduction, runtime boundaries and activity                |
| Bots     | / and /bots              | Six owned strategy projects, search, filters, evidence-aware sorting  |
| My Bots  | /my-bots                 | Browser-local simulation drafts and explicit unavailable copy service |
| Compare  | /compare                 | Select two to four bots, compare facts without allocations            |
| Activity | /activity                | Published-empty or explicit demo events with drill-down               |
| Settings | /settings                | Clear local simulation drafts                                         |
| Learn    | /bots/theta/how-it-works | Accessible Wheel explanation and disclosures                          |
| Owner    | /owner                   | Authenticated read-only release visibility                            |

THETA has dedicated Overview, Performance, Positions, Trade History, Intelligence, Risk and How It Works routes under /bots/theta. Simulation is /bots/theta/simulate. Chains use /bots/theta/chains/{id}. Dataset and period query parameters survive detail-tab navigation. Direct URLs and normal browser history work without a framework router.

## Progressive disclosure

Level one: identity, strategy intent, environment, risk uncertainty, capital uncertainty and primary economic KPIs. Level two: chart, positions, lifecycle, history, explanation and track-record inclusion flags. Level three: calibration, independent sample size, recovery, stress, execution and advanced accounting detail.

Material stock losses are never collapsed out of headline economics. Missing evidence is itself material and remains visible.

## Primary journeys

Discovery to understanding: filter owned bots, open THETA, inspect risk and How It Works, inspect provenance.

Understanding to illustration: explicitly enter demo record mode or the capital scenario. Change capital, contract and cost assumptions. See zero-size or assignment-loss results. Save a local draft in My Bots.

Investigation: open a position, follow its chain, expand accounting and decision details, compare premium with whole-chain P&L.

Owner: enter an existing operator credential, inspect release gates through a short-lived secure session, sign out. No order or configuration mutation is exposed.

## Availability rules

THETA is a PAPER-environment development project with automation not enabled. It has no published customer performance feed. ATLAS, NEXUS, VEGA, EVENT and PULSE are RESEARCH, COMING LATER and NOT AVAILABLE. The website can be deployed in production while trading stays disabled.

Copy controls are a clearly labeled preference foundation. No customer account is connected, capital is not allocated, daily loss preferences are not enforced, and existing positions cannot be joined. Customer identity, subscriptions, broker authorization and copy reconciliation are release gates beyond this UX phase.

## Definition of done and boundaries

All named routes render, API contracts are versioned, demo provenance is persistent, empty/error states are useful, responsive and automated accessibility checks pass, references are captured, root returns 200, and tested main passes CI. No quant-model rewrite, new provider, strategy calibration, live orders or TradePilot coupling is part of this work.
