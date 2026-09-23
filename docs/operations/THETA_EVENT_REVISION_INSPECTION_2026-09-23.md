# THETA event revision inspection, 2026-09-23

Scope: sanitized, read-only inspection of every row currently stored in
`market.optionomics_event_first_observation` through the protected canonical
inspection mapper. No raw payload, provider event ID, credential, account ID,
or secret was returned.

## Result

- Rows inspected: 6
- Inspection state: `COMPLETE`
- Source provider: `OPTIONOMICS`
- Source operation: `optionomics.list_events`
- Source quality: `GOOD` for all 6 rows
- PIT timing state: `TIMING_VALID` for all 6 rows
- Genuine forward observations: 6
- Revisions of the same provider identity: 0
- Ticker-specific/company events: 0
- Macro events: 5
- Fed events: 1

Every row satisfied all of these temporal checks:

1. `providerKnownAt <= thetaFirstObservedAt`
2. `thetaFirstObservedAt <= decisionTime`
3. `scheduledAt > decisionTime`
4. the row retained immutable raw-observation and FusionSnapshot lineage

The rows were first observed by THETA at `2026-09-21T14:00:24.787Z` and
entered the decision snapshot at `2026-09-21T14:00:25.325Z`. Their scheduled
times range from `2026-09-30T12:30:00.000Z` through
`2026-10-28T18:00:00.000Z`.

## Authority conclusion

The six rows are valid prospective macro/Fed PIT evidence. They prove that the
provider-known and THETA-first-observed clocks work for positive event rows.
They do not prove complete prospective earnings/company-event coverage, and
they do not qualify an empty company-event response as a verified negative.

Accordingly:

- `event.prospectiveKnownAt` producer and persistence: `RESOLVED`
- macro/Fed positive PIT evidence: `QUALIFIED`
- company/earnings negative assurance: `PROVIDER_NOT_CAPABLE` on the currently
  authenticated surface
- empty event response to `eventNear=false`: forbidden
- Paper entry authorization changed: `NO`
- broker mutation: `0`
