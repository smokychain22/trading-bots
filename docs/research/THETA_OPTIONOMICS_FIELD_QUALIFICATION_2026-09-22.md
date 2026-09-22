# THETA Optionomics field qualification, 2026-09-22

Status: Slice 10 of the pre-VPS master continuation directive. Every finding
below is a real MCP tool call made this session (`mcp__optionomics__*`)
against real, liquid symbols and real completed historical trading sessions
(verified against `optionomics:///trading_days` before each call, per this
engagement's standing PIT discipline) -- never simulated or extrapolated
from documentation alone.

| Field | Tool/operation | Requested vs. served date | Value type | Example real value | Plausibility | Cross-session stability | Qualification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `atm_iv` | `iv_term_structure`/`option_metrics` | Match, every call | decimal | 0.2627 (AAPL), 0.134 (SPY), 0.412 (TSLA) | Sane (0.1-0.5 range) | Confirmed identical on a duplicate call | **QUALIFIED** |
| `iv_rank` | same | Match | decimal (0-100) | 24.68 | Sane | Internally consistent across all calls | QUALIFIED |
| `iv_percentile` | same | Match | decimal (0-100) | 58.4 | Sane | Same | QUALIFIED |
| `iv30` | `iv_term_structure` | Match | decimal | 0.2628 | Sane | Confirmed stable | QUALIFIED |
| `iv60` / `iv90` | `iv_term_structure` | Match when present | decimal or `null` | `null` for one real session; a real full curve for another | Sane when present | N/A | **PARTIAL_COVERAGE** -- not every session/symbol has a full term structure; correctly reported as `null`/`unknown` rather than interpolated |
| `rv5` / `rv10` / `rv30` / `rv60` | No dedicated field found; `price_history`'s `summary.realized_volatility_percent` (parameterized by `days`) is a plausible but unverified substitute | -- | -- | -- | -- | -- | **PROVIDER_LIMITED** |
| `rv20` | `iv_term_structure` (`realized_vs_implied.rv20`) | Match | decimal | 0.2112 | Sane | Not separately re-tested this pass | QUALIFIED |
| `iv_minus_rv20` | `iv_term_structure` (`realized_vs_implied.spread`) | Match | decimal | 0.0516 (arithmetic-verified against `iv30`/`rv20`) | Sane | -- | QUALIFIED (served under the real field name `spread`, not the literal string `iv_minus_rv20`) |
| `skew` | `iv_term_structure` (`skew.*`) | Match | multiple decimals (`calendar_skew`, `gamma_skew`, `rr25`, `tail_risk_indicator`) | -- | Sane | -- | QUALIFIED, but ambiguous sub-field selection -- a consumer must name exactly which one it means |
| `term_structure` | `iv_term_structure` (`term_structure.state`) | Match | enum (`contango`/`unknown`/etc.) | `contango` for a real SPY session with a full curve | Sane | -- | QUALIFIED |
| `expected_move` | Not found under this or an obvious equivalent name in any tool checked this pass | -- | -- | -- | -- | -- | **NOT_OBSERVED** -- may exist under an unchecked field name; needs a targeted follow-up call before concluding it's absent |
| `max_pain` | `option_metrics` | Match | number (strike) | 320.0, near the real underlying price at the time | Sane | -- | QUALIFIED |
| `call_wall` / `put_wall` | `option_metrics` | Match | number | 320.0 / 300.0 (AAPL); 770.0/765.0 (SPY); 400.0/350.0 (TSLA) | Plausible, brackets the underlying in every case checked | No new independent corroboration method found or attempted | **QUARANTINED -- UNCHANGED**. Plausible values across 3 real symbols/sessions do not, by themselves, satisfy the standing corroboration requirement. |

## Standing quarantine disposition

`call_wall`/`put_wall` remain `QUARANTINED` per the standing policy from prior
sessions of this engagement. This pass's real observations (plausible,
underlying-bracketing values across AAPL/SPY/TSLA) are consistent with the
field being real, but "consistent with" is not "independently corroborated"
-- no method to verify a wall level against subsequent observed price action
was found or attempted this pass. The quarantine is not lifted.

## Fields not promoted merely because the API returned HTTP 200

Every field above returning a plausible number was still individually
assessed against PIT-date-matching, cross-field arithmetic consistency (where
checkable, e.g. `iv_minus_rv20`), and known standing quarantines -- no field
was promoted to `QUALIFIED` solely because a call succeeded.

## Follow-up needed

- `expected_move`: a dedicated, targeted search (checking additional
  Optionomics tools/parameters not exercised this pass, e.g. any options-chain
  or trade-idea endpoint that might carry it under a different name) before
  concluding `NOT_OBSERVED` is final.
- `rv5`/`rv10`/`rv30`/`rv60`: confirm whether `price_history`'s
  `realized_volatility_percent` uses the same methodology as
  `iv_term_structure`'s `rv20` before treating it as a real substitute for
  research use.
