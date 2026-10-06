# THETA Phase 2 capital and risk closure

## Scope

This receipt covers capital reconstruction, ownership evidence retention, strategy-specific account policy, candidate-bound AEGIS evidence, and the sizing waterfall. It does not change policy thresholds, strategy authority, the Paper universe, or execution authorization.

Source baseline: `bae9a0ba897154e716c94664cbc3294ac3390b4d`

Machine-readable Oct 5 audit: `THETA_PHASE2_OCT5_CAPITAL_RISK_AUDIT_20261006.json`

## Oct 5 evidence verdict

- SPY was broker-affordable but incompatible with the governed CSP risk limits. The representative 765 strike required USD 76,500 against USD 99,999.96 equity, or 76.5000306%. Ticker, sector proxy, correlation proxy, portfolio risk, and assignment capacity reached their hard limits.
- A separate SPY candidate that reached AEGIS was hard-vetoed by underlying, sector, and correlation concentration. Account-policy rejection and AEGIS rejection are separate receipts.
- TLT required USD 7,300, or 7.30000292% of equity, and was account-policy compatible. Its reached candidate stopped at AEGIS `HOLD_ONLY` because spread-widening and system-stress evidence were unknown.
- XLE required USD 5,800, or 5.80000232% of equity, and was account-policy compatible. Its reached candidate stopped for the same AEGIS unknowns.
- The Oct 5 archive did not persist numeric TLT or XLE ownership scores. It proves an uncalibrated Paper-bootstrap ownership state, not an ownership-score rejection. Numeric scores remain unknown rather than being reconstructed from incomplete evidence.

## Account-policy census

The immutable Oct 5 archive contains 2,067 generic incompatibility observations and 1,642 unique candidate identities. Unique-candidate counts are IWM 425, NVDA 136, and SPY 1,081.

The unique binding sets are:

- Broker capacity only: 1
- Ticker concentration only: 588
- Ticker, sector, and correlation: 591
- Ticker, sector, correlation, portfolio risk, and assignment capacity: 462

Repeated-cycle observation counts are retained separately in the machine-readable audit.

## Implemented semantics

- Account compatibility is scoped to candidate, strategy, and risk structure.
- CSP and short-DTE CSP use secured collateral and assignment capacity.
- Defined-risk verticals use bounded maximum loss and mark assignment capacity not applicable.
- Covered calls do not add a second copy of stock inventory.
- Broker options buying power is distinct from internal risk-policy capacity. Generic margin buying power cannot substitute for missing options buying power.
- Sector and correlation values for a single flat risk group are labeled conservative proxies. They are not claimed as observed taxonomy or fitted correlation.
- Option multipliers are resolved per exact broker contract. Missing multiplier evidence fails closed. Standard and nonstandard multipliers can coexist in one restart reconstruction.
- Pending opening capital uses remaining order quantity after partial fills. Filled quantity is represented by positions and is not reserved again.
- Candidate ownership evidence and candidate AEGIS evidence survive all post-assessment early returns.
- `DEFINED_RISK_ONLY` is a typed CSP outcome. It does not authorize the defined-risk research branch.
- `ALLOW_REDUCED` is applied once by the canonical sizing authority. No forced minimum quantity exists.
- Every canonical frontier candidate carries one money-management receipt that references account policy, AEGIS, and sizing evidence without recomputing them.

## Authority boundaries

- H and D remain research-only with broker authority false.
- Production policy values are unchanged.
- Expected value and profitability remain empirically unproven where the promoted models are unavailable.
- Order submission and broker mutation remain outside this phase.

## Verification

- TypeScript typecheck: passed.
- Focused Node Phase 2 and integration suite: 301 passed.
- Focused Python AEGIS, sizing, ownership, and monotonicity suite: 130 passed, 489 subtests passed.
- The Oct 5 audit is deterministically regenerated from the immutable local SQLite archive.

Exact-SHA CI and locked deployment evidence are recorded after commit and push.
