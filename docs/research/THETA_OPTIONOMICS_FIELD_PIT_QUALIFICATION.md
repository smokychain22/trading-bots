# Optionomics field-level PIT qualification register

Status: living register. "Not quarantined" is explicitly NOT treated as proof a field is PIT-valid -- every field here is qualified individually from actual observed evidence, never inferred from a sibling field's status. Companion to `THETA_OPTIONOMICS_FIELD_QUARANTINE.md` (which owns the quarantine list itself; this document owns the full per-field evidence, including fields never quarantined).

## Fields tested across multiple real historical/contiguous sessions

| Field | Requested dates tested | Served date match? | Present? | Type valid? | Value plausible? | Historical semantics verified? | Quarantine state | PIT classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `atm_iv` | 2013-01-15, 2018-06-15, 2022-06-15, 2024-01-16, + 25 contiguous sessions 2026-08-17..2026-09-18 | YES, every call | YES | number (decimal) | YES -- values stayed in a plausible 0.10-0.15 range across the 25-session window with one real, internally-consistent local peak (2026-09-16) | Requested-vs-served date match verified on every call; no independent second field exists to cross-check `atm_iv` the way `max_pain_strike` cross-checked `underlying_price` | NOT QUARANTINED | Provisionally usable for descriptive research; NOT independently corroborated the way the quarantine investigation corroborated call_wall/put_wall as unsafe, so treat as "no evidence of a defect found" rather than "proven safe" |
| `iv_rank` | Same as `atm_iv` | YES | YES | number, 0-100 | YES, moved consistently with `atm_iv` direction | Same caveat as `atm_iv` | NOT QUARANTINED | Same as `atm_iv` |
| `iv_percentile` | Same as `atm_iv` | YES | YES | number, 0-100 | YES, moved consistently with `atm_iv`/`iv_rank` | Same caveat as `atm_iv` | NOT QUARANTINED | Same as `atm_iv` |
| `underlying_price` | Same as `atm_iv` plus the original 2013/2018/2022 quarantine probes | YES | YES | number | YES -- independently confirmed to track real historical SPY price levels ($147 in 2013, $277 in 2018, $379 in 2022) | YES -- this is the field whose correct historical tracking is what EXPOSED call_wall/put_wall as broken by contrast | NOT QUARANTINED | Historically trustworthy -- the strongest-evidenced field in this register |
| `max_pain_strike` | 2013-01-15, 2018-06-15, 2022-06-15, 2024-01-16 (SPY); 2015-01-15 (AAPL) | YES | YES | number | Plausible for SPY (144/278/415/474, all reasonably near contemporaneous spot); **implausible for AAPL** (100.71 vs. underlying_price 26.70, a >3.7x mismatch) | Mixed -- SPY evidence supports historical tracking, AAPL evidence contradicts it | NOT QUARANTINED, but see `AAPL max_pain_strike` row below | SPY: provisionally usable. AAPL: UNDER INVESTIGATION, not extended or dismissed |
| `call_wall` | Same dates as `underlying_price`/`max_pain_strike` | YES (the `date` field itself echoed correctly) | YES | number | **NO** -- frozen near current-session strike levels across 3 independent historical SPY dates spanning 2013-2022 | **NO** -- confirmed NOT tracking the requested historical date | **QUARANTINED** | Never PIT-safe until requalified |
| `put_wall` | Same as `call_wall` | YES | YES | number | **NO**, same finding as `call_wall` | **NO** | **QUARANTINED** | Never PIT-safe until requalified |

## AAPL `max_pain_strike` -- separate open investigation (per this directive's explicit instruction)

One real observation (2015-01-15: `max_pain_strike=100.71` vs. `underlying_price=26.70`) contradicts the SPY evidence that this field tracks history correctly. This is NEITHER extended into the `call_wall`/`put_wall` quarantine NOR dismissed as a fluke -- it is its own open item, requiring additional AAPL (and other non-SPY) historical probes across multiple dates before any conclusion. Zero additional probes have been run on this specific question since the finding was first logged.

## Fields observed only once (current/near-current session), never tested historically

These fields were observed in exactly one `iv_term_structure(SPY)` call (no `date` parameter -- current session only, from an earlier pass this session) and have NEVER been requested at a historical date. Their historical PIT validity is completely untested, not merely unconfirmed:

| Field | Present? | Type valid? | Value plausible (current session)? | Historical semantics verified? | Quarantine state | PIT classification |
| --- | --- | --- | --- | --- | --- | --- |
| `iv30` / `iv60` / `iv90` (term structure) | YES | number | YES (0.1284/0.1423/0.1411, a plausible near-flat curve) | **NOT TESTED** | NOT QUARANTINED | UNKNOWN for any historical date -- current-session-only evidence |
| `iv_slope` / `iv_slope_ratio` / `state` (term structure) | YES | number/string | YES (contango, slope 0.0127) | **NOT TESTED** | NOT QUARANTINED | UNKNOWN for any historical date |
| `iv_minus_rv20` (`realized_vs_implied.spread`) | YES | number | YES (0.0309) | **NOT TESTED** | NOT QUARANTINED | UNKNOWN for any historical date |
| `rv20` (`realized_vs_implied.rv20`) | YES | number | YES (0.0975) | **NOT TESTED** | NOT QUARANTINED | UNKNOWN for any historical date |
| `calendar_skew` / `gamma_skew` / `rr25` / `tail_risk_indicator` (skew) | YES | number | YES (0.0136 / 241M / -0.0817 / 1.319) | **NOT TESTED** | NOT QUARANTINED | UNKNOWN for any historical date |

## Fields never observed at all in this session

| Field | Status |
| --- | --- |
| `rv5` | NOT OBSERVED -- not present in any `option_metrics` or `iv_term_structure` response seen this session. Whether Optionomics exposes this field at all, under what name, and through which tool, is itself unestablished. |
| `rv10` | NOT OBSERVED, same caveat as `rv5` |
| `rv30` | NOT OBSERVED, same caveat |
| `rv60` | NOT OBSERVED, same caveat |

## Governing rule (repeated per this directive)

A field's absence from the quarantine list means only that no defect has been FOUND yet -- it is never treated as proof the field is safe. Every field above with "NOT TESTED" or "NOT OBSERVED" historical status must be independently probed across multiple real historical dates, the same way `call_wall`/`put_wall` were, before any research module treats it as historically trustworthy.
