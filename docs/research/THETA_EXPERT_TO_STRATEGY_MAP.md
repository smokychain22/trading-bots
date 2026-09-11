# THETA Expert-to-Strategy Map (R6F)

Distills `THETA_STRATEGY_ENGINE_AND_IMPLEMENTATION_SPEC_v1.0` section 28's own
expert table (the owner's already-consolidated distillation of the trader
corpus) into the `E.1 Expert / trader evidence record` format the spec itself
requests, cross-referenced against `hypotheses.json`'s existing 14 entries.
**No new hypothesis is created here** -- every source's lesson below maps to an
existing hypothesis or an existing architectural constraint; none introduces a
materially distinct mechanism + falsification test that isn't already
registered.

`ExpertReliability = DataQuality * RegimeFit * Recency * SampleConfidence *
Independence * Transferability` is used here as the stated RESEARCH CONCEPT
(spec section 28), never computed as a real number -- no source below has the
independent, quantified inputs this formula would require.

| Source | observation_status | Borrowed THETA prior | Explicitly NOT inferred | Existing hypothesis / constraint |
|---|---|---|---|---|
| Orange Cat | OBSERVED | Selectivity, full-cycle patience, acceptable ownership | Exact delta/DTE/IV/roll/TP thresholds | H-Q-01 (ownership screening), H-R-02 (patience) |
| IWM Hold the Strike | OBSERVED | Dedicated THETA_HOLD_STRIKE challenger (2-5 DTE ATM, intentional assignment, recovery wait) | Generalization to other tickers/regimes; low-risk inference from high WR | H-H-01 |
| SQQQ Hold the Strike | OBSERVED | AEGIS inventory/tail-risk failure control | Closed-trade WR as portfolio safety | H-H-02 (measurement discipline) |
| Fearless Value | RECONSTRUCTED | Ownership overlay + tail warning | Equating conviction with bounded risk | `strategy_archetypes.json`'s `cross_cutting_failure_dna` (already cites this source) |
| MAR1 QUANT | RECONSTRUCTED | Architecture/management hypotheses (session specialization, expiry/TP/SL/no-trade/conversions) | Exact timing/rules as validated | `ProfitTakingPolicy`/`LossPolicy` families (management_policy.py) -- benchmark inputs only |
| Sage Volatility Margin | RECONSTRUCTED | OOS discipline / tail protection methodology | Forcing every method into a 70-80% WR target | Standing "no performance fabrication" constitutional rule (spec section 1) |
| Kilo | INFERRED | Specialization methodology | Direct THETA execution branch | REFERENCE_ONLY -- no THETA component yet |
| EnhancedMarket (recent slice) | OBSERVED | Strategy-decay control (recent segmentation over lifetime headline metrics) | Reliance on lifetime headline metrics | `champion_challenger.py`'s health-drift/`DEGRADED` status (R6F) |
| Swayd | OBSERVED | Specialization + degradation lesson | Universal skill inference | Same as EnhancedMarket -- drift/degradation discipline |
| Hendo_67 | OBSERVED | THETA management teacher (CSP/CC/Wheel lifecycle, close/roll/assignment behavior) | Universal 50% close rule | H-R-01/H-R-02 (roll/patience pair), H-C-01 (CC utility) |
| Alex | RECONSTRUCTED | Roll/management hypotheses (rolling/adjustment evolution) | Every roll assumed positive EV | H-R-03 (RollUtility must beat alternatives, RETAIN) |
| David Romic | INFERRED | THETA candidate prior (conservative income process) | Large-sample causal claim | H-Q-01 (secondary source) |
| The Dragon's Prodigy | RECONSTRUCTED | AEGIS/decision-discipline teacher (WAIT + fixed-dollar risk, lower WR with strong payoff) | Direct THETA-specific policy | `management_policy.py`'s `GlobalWaitReason`/`validate_global_wait_evidence` |
| US Stock Momentum | RECONSTRUCTED | Underlying selector (momentum/trend/sector overlay) | Standalone option-entry command | `rsi_trend_momentum` feature (feature_taxonomy.py, UNDERLYING family, SOFT_FEATURE role) |
| Lick Neeson | INFERRED | Structure-router hypothesis (CSP/Wheel/CC + credit spreads/IC/strangles) | Production policy from incomplete evidence | H-D-01 (BLOCKED_ON_DATA) |
| Wheeling to Freedom | OBSERVED | Empirical management teacher (repeated BUY_CLOSE + stock inventory, active lifecycle) | Exact hidden threshold / universal 50% rule | H-R-01 (active management hypothesis) |
| Ivan Orehovec (main) | OBSERVED | Portfolio/structure router + conditional management (short puts, rolls, long optionality, stock/dividends) | Reduction to one CSP algorithm | H-A-01 (assignment acceptability) |
| Ivan Orehovec (small account) | INFERRED | THETA_DEFINED_RISK hypothesis (defined-risk spreads/IC profile) | Challenge language treated as expected return | H-D-01 (same as Lick Neeson) |
| Selective Edge (public C2) | UNKNOWN | Ownership-first benchmark/hypothesis (UnderlyingQuality -> AcceptableOwnership -> option overlay) | Hypothetical metrics as live proof | H-Q-01 (secondary corroboration) |
| Option Alpha (0DTE aggregate) | OBSERVED | NEXUS/management research benchmark (large 0DTE aggregate; timing/management matter; many trades not held to expiry) | Direct THETA_CONVENTIONAL policy (0DTE is out of THETA-Q's DTE lattice entirely) | REFERENCE_ONLY -- out of current scope (0DTE belongs to a future PULSE-family bot per `CLAUDE.md`, not THETA) |
| Alertsify (DannyMtb example) | OBSERVED | Trader-policy reconstruction template (broker-fill behavioral segmentation by ticker/session/holding time) | Causal/future stability from one observed slice | §28.1 trader-policy reconstruction method itself (methodology, not a THETA feature) |

## Sources newly added by the spec vs. the prior R6/R6D-era map

Fearless Value, MAR1 QUANT, Sage Volatility Margin, Kilo, EnhancedMarket,
Swayd, The Dragon's Prodigy, Option Alpha (0DTE aggregate), and Alertsify
DannyMtb are new names in this consolidated spec relative to the smaller
11-source list mapped in an earlier phase. Every one of them was checked
against the existing 14-entry `hypotheses.json` above and against
`strategy_archetypes.json`'s `cross_cutting_failure_dna` -- none required a
new hypothesis; each maps to an existing mechanism, an existing failure-DNA
constraint, or an existing (non-THETA-scope) REFERENCE_ONLY classification.

## Counts

- Sources mapped: **21** (every named individual/platform in spec section 28).
- OBSERVED: 10. RECONSTRUCTED: 6. INFERRED: 4. UNKNOWN: 1.
- Hypotheses added this phase: **0** (14 before, 14 after).
