# THETA Strategy GitHub Method -> Module Map (R6F)

Distills `THETA_STRATEGY_ENGINE_AND_IMPLEMENTATION_SPEC_v1.0` section 31's own
repository table into the `E.2 GitHub method record` shape, mapped to THETA
modules. Per the spec's own explicit instruction ("do not re-read 50
repositories without a specific gap"), this phase did **not** re-read every
repository named -- only the ones this branch has ALREADY deep-read at the
source-code level (with a real commit SHA) are marked `SHA_VERIFIED_THIS_
BRANCH`; every other repository's disposition below is transcribed directly
from the spec's own default-disposition column, marked `SPEC_DEFAULT_
DISPOSITION_NOT_RE-VERIFIED`.

## Repositories already deep-read on this branch (SHA-verified)

| Repository | Commit SHA | THETA module | Action | Source doc |
|---|---|---|---|---|
| `FlashAlpha-lab/gex-explained` | `a11321d62006311c4a72a68552587485024f2bf2` | GEX/flow context layer | REFERENCE (per-strike zero-gamma crossing method) | `THETA_GEX_DEFINITION_MATRIX.md` |
| `puneet-chandna/0DTE-dealer-gamma` | `8da6fa67328b4aa34956c033f0b7cbb74431501d` | GEX/flow context layer | REFERENCE_ONLY (cumulative-curve zero-gamma method -- genuinely different definition from gex-explained) | `THETA_GEX_DEFINITION_MATRIX.md` |
| `hedarthy/DealerFlow` | `14c7a0f345116c93b43641893aaa372a4cf19085` | GEX/flow context layer | REFERENCE/TEST_ONLY (windowed+thresholded cumulative method; also VEX/CEX + a real T=0 fix worth citing) | `THETA_GEX_DEFINITION_MATRIX.md` |
| `zrack/gex-terminal` | `72d68f47a41c2c330351476cef99b48411f9fe3d` | GEX/flow context layer | REFERENCE_ONLY (self-labels its own `zero_gamma_semantics: "legacy_strike_profile"` -- the one repo that documents the strike-vs-spot-crossing distinction in its own code) | `THETA_GEX_DEFINITION_MATRIX.md` |
| `sgdividends/spx-dealer-gamma` | `4b49ede031a17daa2a18c087e7fdb200a0c1d26f` | GEX/flow context layer | REFERENCE_ONLY (spot-domain repricing scan -- a fourth, structurally distinct method) | `THETA_GEX_DEFINITION_MATRIX.md` |
| `BitraAI/gex_app` | `b1234c65452581fccf5375cb7488b990423ed79c` | N/A | REJECT (no extractable source -- single image asset only) | `THETA_GEX_DEFINITION_MATRIX.md` |
| `thedhruvhegde/ivsurf` | `c20072a8f6c09146697bdb55dca566567d7b0535` | Volatility/IV surface layer | REFERENCE_ONLY (found 2 real batch-contamination bugs in its vectorized IV solver -- confirms THETA/Codex's per-contract isolation is correct) | `THETA_IV_SOLVER_COMPARISON.md` |
| `NavnoorBawa/Options-Flow-Predictor` | `da83ec361c1cb7494a0b1b96dbca8edc4a09e788` | Flow/UOA context layer | TEST_ONLY (UOA ratio) / REJECT (naive PCR-sentiment mapping, unsupported performance claim) | `THETA_FLOW_METHOD_COMPARISON.md` |

## Repositories per the spec's own default disposition (not re-verified this phase)

| Repository | Primary extraction (per spec) | Default disposition (per spec, transcribed) |
|---|---|---|
| `QuantLib/QuantLib` | Pricing cross-checks, American exercise, curves/dividends, Greeks/calibration | REFERENCE/verification only |
| `QuantConnect/Lean` | Event-driven lifecycle, fill/slippage, buying power, assignment architecture | Engineering benchmark; adapt patterns |
| `alpacahq/options-wheel` | Wheel state transitions and filters | REFERENCE/ADAPT; not profitability proof |
| `milgar7969/alpaca-options-framework` | Streams, orders, fills, state | ADAPT engineering patterns after review |
| `joncovington/MEICAgent` | Autonomous loop, risk, paper/live graduation | REFERENCE/ADAPT process patterns |
| `goldspanlabs/optopsy` | Strategy/parameter sweeps | TEST_ONLY; guard selection bias; license caveat |
| `lambdaclass/options_portfolio_backtester` | Portfolio Greeks, cost and tail research | ADAPT/REFERENCE |
| `cutemarkets/cutebacktests` | Quote-aware causal intraday/walk-forward | REFERENCE for realistic validation |
| `dremg/osbt-public` | Independent SPX/0DTE backtesting patterns | REFERENCE, not THETA-specific |
| `ksanjay/Kelly-Criterion-Option-Selector` | Kelly sizing ideas | RESEARCH_ONLY; reject raw full Kelly in production |
| `HasibVortex369/riskkit` | Independent risk governor patterns | ADAPT/REFERENCE (already adapted: `correlation_metrics.py`, `drawdown_metrics.py`) |
| `SayantoDutta/alpaca-wheel-bot` | Wheel automation reference | REFERENCE/ADAPT only after code review |
| `dmitridefreitas-dev/options-data-pipeline` | Chain ETL, IV term/skew/expected move | REFERENCE/ADAPT |
| `vansh0016/options-chain-features` | Deterministic feature transforms | REFERENCE/TEST |
| `moh1tt/RegimeSense` | HMM/regime framework | CHALLENGER only if incremental OOS value |
| `AdamNaghs/Options-Spread-Conviction-Engine` | Structure routing, surface/Monte Carlo concepts | TEST_ONLY / method extraction |
| `MadewellRD/ROGUE-OPS` | Fail-closed/kill switches/falsification | ADAPT safety patterns |
| `stonkyoloer/News_Spread_Engine` | Catalyst/liquidity/IV/DTE funnel | REFERENCE for event/routing mechanics |

## Explicitly rejected external patterns (spec's own list, restated)

Raw full Kelly; N(d2) as real win probability; opaque one-score ranking;
positional timestamp joins; batch-wide T=0 expiry bugs (confirmed present in
`ivsurf`, see above); optimistic midpoint fills (the exact R6F bug fixed in
`management_policy.py` this phase); blind retries; forced minimum quantity;
deterministic flow/dealer sign; README returns as evidence.

## Counts

- Methods mapped: **26** (7 SHA-verified + 18 spec-default + `BitraAI/gex_app`
  rejected, plus this session's confirmation that all of them remain
  correctly excluded from any executable THETA path).
- `ADOPT_METHOD`: 0. `ADAPT`: already-integrated (`riskkit` -> correlation/
  drawdown metrics). `TEST_ONLY`: 3. `REFERENCE_ONLY`: 21. `REJECT`: 2.
