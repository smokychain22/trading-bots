# THETA capability coverage denominator (Wave 6 Batch 2)

## No new registry

Per the directive, this reconciles the two existing registries rather
than creating a third:

- `src/providers/capability-registry.ts` (Codex-owned, 136 lines) --
  **provider-scoped**: tracks per-provider (Alpaca/Optionomics)
  connection/readiness state (`persistProviderCapabilities`), consumed by
  operational readiness checks. It answers "is this provider connection
  healthy," not "does THETA have a real decision capability."
- `src/research/pre-vps-capability-registry.ts` (Claude-owned, now 469
  lines after this pass) -- **system-scoped**: tracks THETA's own
  decision capabilities (producer/consumer/persistence/authority/
  maturity/blocker per capability), independent of which provider backs
  it. This is the real denominator for "decision-critical capability
  coverage."

These stay separate because they answer different questions at different
layers -- a provider can be `GOOD` in the provider registry while the
system capability it backs is still `PARTIAL` or has an unrelated
blocker (e.g. Alpaca connection healthy, but `ASSIGNMENT_CAPACITY` still
has a real `MISSING_PRODUCER` gap in `src/theta/`, nothing to do with the
provider connection itself).

## The defined decision-critical capability universe (27 domains, per directive)

Every domain the directive named, mapped to its real `capabilityId` row(s)
in `pre-vps-capability-registry.ts`:

| Domain | capabilityId row(s) | Status |
|---|---|---|
| broker/account | `BROKER_ACCOUNT` | pre-existing |
| market/session | `MARKET_CLOCK` | pre-existing |
| positions/orders/fills | `BROKER_POSITIONS`, `BROKER_OPEN_ORDERS`, `BROKER_ORDER_SUBMISSION` | pre-existing |
| reconciliation | `BROKER_RECONCILIATION` | pre-existing |
| universe | `UNIVERSE_DISCOVERY`, `UNDERLYING_RANKING` | pre-existing |
| ownership | `OWNERSHIP_CONTRACT` | pre-existing |
| optionability | `OPTIONABILITY_CHECK` | pre-existing |
| chain | `OPTION_CONTRACT_DISCOVERY` | pre-existing |
| quote | `EXECUTABLE_BBO` | pre-existing |
| DTE/strike/delta | `DELTA_STRIKE_DTE_LATTICE` | pre-existing |
| volatility | `VOLATILITY_SURFACE` | **added this pass -- real gap** |
| events | `EVENT_RISK_STATE`, `CORPORATE_ACTION_EVIDENCE` | pre-existing |
| portfolio | `AEGIS_SECTOR_CORRELATION`, `CORRELATION_EVIDENCE`, `CORRELATION_WINDOW_STABILITY` | pre-existing |
| AEGIS | `AEGIS_EVALUATION`, `AEGIS_SYSTEM_LIQUIDITY_STRESS` | pre-existing |
| sizing | `SIZING_UNKNOWN_VS_EARNED_WAIT` | pre-existing |
| routing | `STRATEGY_ROUTING` | **added this pass -- real gap** |
| economics | `CROSS_STRATEGY_ECONOMIC_COMPARISON`, `ROLL_CC_CANDIDATE_VALUATION` | pre-existing |
| WAIT | `SIZING_UNKNOWN_VS_EARNED_WAIT`, `UNIVERSE_OPPORTUNITY_REGRET_SCHEMA` | pre-existing |
| execution | `EXECUTION_QUALITY` | **added this pass -- real gap** |
| management | `QUARANTINED_MANAGEMENT_ARCHITECTURE`, `ROLL_CC_CANDIDATE_SOURCE` | pre-existing |
| assignment | `ASSIGNMENT_CAPACITY` | **added this pass -- real gap** |
| recovery | `RECOVERY_LIFECYCLE` | **added this pass -- real gap** |
| CC (covered call) | `ROLL_CC_CANDIDATE_VALUATION`, `ROLL_CC_CANDIDATE_SOURCE` | pre-existing |
| accounting | `WHOLE_CHAIN_ACCOUNTING` | pre-existing |
| copy | `COPY_ENGINE` | **added this pass -- real gap** |
| exports | `CROSS_STRATEGY_RESEARCH_CONTRACT`, `UNIVERSE_OPPORTUNITY_REGRET_SCHEMA` | pre-existing |
| learning | `EMPIRICAL_LEARNING_GOVERNANCE` | **added this pass -- real gap** |

## Why these 7 were genuinely missing, not just unlabeled

Cross-referencing the registry's 33 pre-existing `capabilityId` rows
against the directive's own 27-domain list found 7 domains with **no
row at all** (not merely a naming mismatch): `STRATEGY_ROUTING`,
`EXECUTION_QUALITY`, `ASSIGNMENT_CAPACITY`, `RECOVERY_LIFECYCLE`,
`COPY_ENGINE`, `VOLATILITY_SURFACE`, `EMPIRICAL_LEARNING_GOVERNANCE`.
Each new row is grounded in real source files already directly read this
engagement (several -- `ASSIGNMENT_CAPACITY`, `RECOVERY_LIFECYCLE` --
cite this pass's own new findings: the `assignmentCapacity`
`MISSING_PRODUCER` and the `recovery_contract.py` unwired-bridge finding
from the method census). No row was invented from a plausible-sounding
name; each cites its real `sourceFiles`.

## Final numbers

```
CAPABILITY_UNIVERSE_TOTAL = 27 (defined decision-critical domains, per directive)
CAPABILITY_AUDITED = 27 (every domain now has >= 1 real, source-grounded registry row)
CAPABILITY_COVERAGE = 100% of the explicitly defined 27-domain decision-critical universe

Registry row count (pre-vps-capability-registry.ts) = 40 (33 pre-existing + 7 added this pass)
Rows with currentState=REAL = 20
Rows with currentState=PARTIAL = 8 (includes 3 new: ASSIGNMENT_CAPACITY, RECOVERY_LIFECYCLE, VOLATILITY_SURFACE)
Rows with currentState=NOT_INDEPENDENTLY_VERIFIED = 8 (includes 2 new: COPY_ENGINE, EMPIRICAL_LEARNING_GOVERNANCE)
Remaining rows (STUB_DEFAULT/MISSING/QUARANTINED_NO_CALLERS) = 4 (all pre-existing, unchanged)
Every one of the 7 new rows carries a real, specific, source-grounded blocker where currentState is not REAL -- never a placeholder.
```

**100% here means complete against the explicitly defined decision-critical
universe** (27 named domains), exactly as the directive specified -- it
does not mean every helper function or every provider endpoint in the
repository has its own row. `validateCapabilityRegistry()` (unchanged
function, now validated against 40 rows) confirms no duplicate
`capabilityId`s and no incomplete required fields across the full
extended registry -- all 7 existing tests in
`tests/pre-vps-capability-registry.test.ts` still pass unmodified.
