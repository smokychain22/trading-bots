# THETA Event Risk Policy Study

Date: 2026-09-20  
Finding: `INSUFFICIENT_PIT_EVENT_HISTORY`  
Activation state: `PENDING_RESEARCH_REVIEW`

## Point-in-time audit

The study inspected all 4,729 candidate evidence rows in the current Aiven window. Each row has a structurally present `event_json` object, but none has a usable `knownAt` timestamp and no event family is populated.

| Measure | Result |
|---|---:|
| Candidate rows | 4,729 |
| Non-empty event objects | 4,729 |
| Valid `knownAt` timestamps | 0 |
| Point-in-time-safe `knownAt` timestamps | 0 |
| Known-after-decision violations | 0 |
| Identified event types | 0 |

The object count therefore measures schema presence, not usable event intelligence. Treating these objects as event-safe evidence would be cosmetic and incorrect.

## Required event families

The existing normalized event contract can represent verified source, provider event ID, underlying, event type, event time, `knownAt`, observation time, payload hash, applicability, and validation reasons. A policy study still needs real point-in-time rows for at least:

- earnings and earnings-distance windows
- ex-dividend state
- scheduled macro events relevant to the position horizon
- corporate actions
- provider corrections and cancellations

Each family needs its own known-time semantics. Scheduled time, publication time, and ingestion time cannot be substituted for one another.

## Decision

No event blackout, penalty, or size-reduction threshold is promoted. Missing event evidence remains `UNKNOWN`, never `PASS`. Event policy research can resume after real `knownAt` coverage spans enough independent events and outcomes.

