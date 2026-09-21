# Optionomics field quarantine

Status: living register of Optionomics MCP fields found NOT reliably point-in-time or otherwise unsafe for research use, pending further validation. A quarantined field must not be consumed by any THETA research module (Claude-owned) or Production adapter (Codex-owned) until it is explicitly requalified here with new evidence and this document is updated. `brokerAuthority: false` throughout -- this document records research findings, not a Production capability decision.

## QUARANTINED: `option_metrics.call_wall` / `option_metrics.put_wall`

**Evidence (real MCP calls, this session, 2026-09-21):**

| Symbol | Requested date | Underlying price (real, tracks date) | `call_wall` | `put_wall` | `max_pain_strike` (real, tracks date) |
| --- | --- | --- | --- | --- | --- |
| SPY | 2013-01-15 | 147.07 | 695.0 | 680.0 | 144.0 |
| SPY | 2018-06-15 | 277.13 | 700.0 | 680.0 | 278.0 |
| SPY | 2022-06-15 | 379.20 | 700.0 | 680.0 | 415.0 |
| SPY | 2024-01-16 | 474.93 | 475.0 | 475.0 | 474.0 |
| SPY | 2026-09-21 (current) | 766.85 | 772.0 | 745.0 | 760.0 |

**Finding:** `call_wall`/`put_wall` are effectively FROZEN near current-session (2026) strike levels (695-700 / 680) across THREE independently-requested historical dates spanning 2013-2022, despite `underlying_price` and `max_pain_strike` on the SAME responses varying correctly and plausibly with the requested date. Only the 2024-01-16 response (closer to the present) shows a `call_wall`/`put_wall` that tracks its own underlying_price -- consistent with these fields reflecting something close to a CURRENT/near-current options-chain computation rather than a genuinely historical one for older dates, even though the endpoint accepts and echoes an arbitrary historical `date` parameter.

**Consequence:** `call_wall` and `put_wall` (and, by the same class of hazard, ANY field that has not been independently spot-checked against the requested date the way `underlying_price`/`max_pain_strike` were here) must be treated as UNKNOWN for any date meaningfully in the past, not as a genuine historical observation, until Optionomics either documents the field's actual computation window or further probing narrows exactly when the field starts tracking history correctly. This is exactly the class of defect `historical-iv-spread-feasibility.ts`'s `assessHistoricalIvBackfillFeasibility` (this session's Item D repair) exists to catch structurally -- a SCHEMA-level proof of historical capability is not proof that every individual field in that schema is actually historical.

**Never repaired by:** substituting a "close enough" recent wall value, interpolating between known-good dates, or assuming the anomaly is isolated to SPY (AAPL's `max_pain_strike` at 2015-01-15 was also implausible: 100.71 against an underlying_price of 26.70 -- a >3.7x mismatch -- suggesting the hazard may extend beyond `call_wall`/`put_wall` specifically and needs its own separate investigation before AAPL's `max_pain_strike` is trusted for historical dates either).

**Requalification path:** probe a dense, contiguous run of historical dates (not scattered years) for at least one symbol, and confirm `call_wall`/`put_wall` move in a way that is at minimum monotonically plausible relative to the contemporaneous `underlying_price` at each date, before removing the quarantine.

## Provider-capability caveat: REST vs MCP are separate surfaces

The Optionomics REST route documentation (referenced in `docs/operations/THETA_EVENT_EVIDENCE_GAP.md`, e.g. the public calendar guide) does not necessarily describe the SAME parameter surface as this MCP server. Confirmed this session: `options_chain`'s MCP tool schema exposes `strike_min`/`strike_max`/`option_type`/`expiration_date`/`limit` filters that produced correct, deterministic, filtered results in real calls -- whether the underlying REST route Codex's Production adapter calls supports the identical filter set is a SEPARATE, unverified question. Do not assume MCP-documented behavior applies to Codex's REST-based Production adapter, or vice versa, without independently verifying each surface.

## Confirmed provider window cap: `events()`

`events()` silently caps its served window at exactly `from + 30 days` regardless of the requested `to` (confirmed twice this session: requesting `to = from + 365 days` and `to = from + 59 days` both echoed back `to = from + 30 days` exactly). The response ALWAYS echoes the real served `from`/`to` -- callers must check the echoed window on every call and chunk any longer query into ≤30-day segments; treating the requested window as served without checking the echo will silently under-cover the intended range.
