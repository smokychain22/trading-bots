# THETA prospective event evidence gap

Status: open. Paper-only runtime must retain unknown event and corporate-action states. This document describes code and provider-contract coverage, not an authenticated production capability verdict.

Provider references: [Alpaca corporate actions API](https://docs.alpaca.markets/us/reference/corporateactions-1), [Optionomics market calendar](https://docs.optionomics.ai/features/calendar/), [Optionomics earnings analysis](https://docs.optionomics.ai/features/earnings/). Product UI documentation does not establish the authenticated REST response contract or complete negative coverage.

## Current producer-to-consumer map

| Source | Current adapter | Timestamp and coverage semantics | Runtime consumer | Result |
| --- | --- | --- | --- | --- |
| Alpaca corporate actions | `src/providers/readiness.ts` probes `GET /v1/corporate-actions`; `src/theta/alpaca-provider.ts` does not normalize it | Provider warns that announcement ingestion may lag. Empty results alone cannot certify absence of a pending action. | `universe.unsupportedCorporateActionPending` and `regime.corporateActionPending` | Unknown until a positive action and its identity are verified, or a bounded negative-coverage policy is approved. |
| Optionomics events | `src/theta/optionomics-provider.ts` `EVENTS` observation | Normalized rows retain `knownAt`, `scheduledAt`, `publishedAt`, response hash and retrieval time. These fields are not proof that the search covers every earnings or macro event. | FusionSnapshot event context; no qualified universe proximity producer | Known event rows are research context. Event absence remains unknown. |
| Optionomics earnings filings | `src/theta/optionomics-provider.ts` `EARNINGS_FILINGS` observation | Filing history is distinct from a complete prospective earnings calendar. `scheduledAt` is nullable. | FusionSnapshot event context; `earningsDistanceDays` remains null | Do not infer a future earnings date from an unspecified filing date. |
| Optionomics symbol news | `src/theta/optionomics-provider.ts` `SYMBOL_NEWS` observation | Publication and retrieval times may differ. A story is not an event calendar. | FusionSnapshot event context | No negative event-coverage authority. |
| Internal normalized event evidence | `src/theta/normalized-event-evidence.ts` | Both provider-known time and actual THETA observation must precede the decision. | Test/research contract, not yet fed by a persistent first-observation producer | No retrospective backdating. |

`src/theta/universe-discovery.ts` now emits null for both event flags. `src/theta/universe-policy.ts` distinguishes known true, known false, and unknown. Shadow evidence can continue, while `src/research/production-shadow-runtime.ts` requires qualified event eligibility before a new Paper action plan is queued. This currently prevents new Paper entries until coverage is resolved. It does not stop reconciliation or management of existing positions.

## Required next proof

1. Probe the approved providers with authenticated, sanitized responses during a supported session. Record the exact schema, pagination, provider timestamps, search window and entitlement state without storing credentials.
2. Persist first-observed time for an event identity before using it in a decision. A provider publication timestamp cannot establish when THETA saw it.
3. Define a versioned event horizon and a bounded negative-coverage rule. A successful empty API response is not sufficient without documented completeness and latency semantics.
4. Connect verified positive events and qualified negative coverage to the universe, regime, earnings-distance and Paper-plan paths. Keep unknown fail-closed in the meantime.
5. Run a no-submit valid-candidate fixture and optional/hard evidence removal matrix after the producer contract is established.

The current missing Paper-entry fields are `universe.unsupportedCorporateActionPending` and `universe.eventNear`. This is a safety/data-contract blocker, not evidence that THETA found no opportunity. Research-only GEX/flow/surface unknowns must not be substituted for these fields.
