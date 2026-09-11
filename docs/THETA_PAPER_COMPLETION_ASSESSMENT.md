# THETA Paper execution and profitability assessment

## Decision and authority

The owner designates the connected owner account for `MASTER_THETA_PAPER`, subject to explicit persisted broker-account identity and role verification. A customer connection alone does not implement that designation. The same broker account must never participate as both master and follower. Role uniqueness must use broker identity, not merely a customer UUID, email, masked account number, or API-key identifier.

The latest owner directive authorizes autonomous Paper execution once engineering gates pass. It supersedes the earlier requirement for a second generic first-order authorization. It grants no live-money authority. It does not authorize bypassing missing data, unverified policy inputs, unreliable scheduling, or absent reconciliation. No execution flags are enabled by this assessment.

This is a private-beta product extension to the frozen v1.1 public-copy scope. It preserves canonical strategy, accounting, provider, provenance, and risk rules. The extension requires master-fill-first replication, tenant isolation, account-specific sizing, optional user overlays, and independent follower economic accounting. Public OAuth remains a future release path and existing OAuth code must be preserved.

## Confirmed repository state

Audit baseline: main `f0d32926d09303ff2518bb29c66ab79ceed61f66`, inspected September 11, 2026. These are code findings, not a fresh assertion about deployed database contents or brokerage balances.

| Surface | Evidence | Assessment |
|---|---|---|
| Owner account role | Customer credential provider still reads follower credential storage | Explicit connected-account promotion and self-copy exclusion need implementation and verification |
| Real-state runner | `src/theta/theta-shadow-once.ts` | Development-only, manual-input acknowledgement, placeholder policies, production refusal |
| Decision persistence | Same runner outputs `NOT_PERSISTED` | Not a durable autonomous production decision loop |
| Scheduler | `src/theta/scheduler.ts` | Job types and transitions exist, this module does not implement an operating leased worker |
| Customer policy persistence | `src/customer/customer-store.ts::saveParticipation` | Accepts allocation only and inserts fixed limits, ignores the newly required optional overlay semantics |
| Broker order construction | `src/execution/order-construction.ts` | Explicit semantic THETA actions exist, broker payload does not yet carry `position_intent` |
| Execution gate | `src/execution/execution-control.ts` | Invalid parsed timestamps could evade expiry comparison. Corrected with fail-closed finite-time validation and regression tests |
| Copy system | `src/customer/copy-engine-contract.ts` | Contracts and checks exist. They do not establish a running master-fill-to-follower reconciliation service |
| Empirical evidence | Expert registry explicitly labels its entries research priors | No verified THETA 70-80% claim follows from that registry |

Claude branch `origin/claude/theta-r1-real-state` has six commits beyond the shared baseline, through `98eedfb`: temporal consistency, calendar, event state, AEGIS derivation, pending-order economics, and assignment capacity. Their titles and file changes were inspected. They have not been declared integrated or independently validated by this assessment. Preserve them and review as a separate integration milestone, particularly overlap with main's calendar changes.

`THETA_REAL_CAPABLE = PARTIAL`. `READY_FOR_FIRST_PAPER_ORDER = NO` at this audit boundary. Current account balances, account-wide order counts, and deployed database health require a fresh authenticated receipt. No Paper or live broker order was submitted during this assessment.

## Economic objective and the win-rate question

There is no current evidence sufficient to promise a 70-80% Managed Episode win rate. A target is a research question. A working login, successful account read, attractive strategy description, or passing software test is not economic evidence.

For a simplified two-outcome example, let p be win probability, W the average gross win, L the positive magnitude of the average gross loss, and C the average total cost:

`EV = p*W - (1-p)*L - C`

`BreakEvenWR = (L+C)/(W+L)`

Illustrative arithmetic, not THETA results: at 75% wins, $100 average wins, $400 average losses, and $5 costs, EV is -$30. At 65% wins, $200 average wins, $250 average losses, and $5 costs, EV is +$37.50. If W and L are already after cost, do not subtract C again. Flat outcomes require explicit treatment rather than silently dropping them.

Report net expectancy, profit factor, average win/loss, economic drawdown, expected shortfall, capital-days, inventory age, open losses, and calibration beside win rate. Define the Managed Episode boundary before evaluation and retain whole-chain lineage across rolls and assignment. Report unresolved episodes separately without removing their mark-to-market losses from equity or drawdown.

As a statistical illustration, 75 wins among 100 independent trials gives a roughly 65.7%-82.5% 95% Wilson interval. At 750 of 1,000, it is roughly 72.2%-77.6%. Overlapping positions, shared underlyings, and common market shocks make independence optimistic. Use clustered and time-aware uncertainty estimation. Followers copying one trade do not create new independent strategy observations.

## Evidence from option-writing research

Bondarenko's 2019 Cboe-supported index study gives a useful counterexample to premium chasing. For 2006-2018, weekly put writing collected greater average annual gross premium than monthly writing, but its compound annual return was lower. The study also reports substantial drawdowns. These are historical index results with different instruments, settlement, and implementation assumptions from a single-stock Wheel. They motivate investigation of compensated volatility risk, not a transferable THETA forecast. [1]

The design implication is to optimize total economics and capital use, not gross premium, trading frequency, or closed-leg wins. A premium seller accepts downside and volatility risk in exchange for compensation that may be insufficient in a particular contract, event, or regime.

The repository's expert registry contains eleven entries and explicitly calls them `D_EXPERT_DNA`. Orange Cat suggests patience and ownership discipline. IWM Hold the Strike suggests a short-DTE assignment-aware challenger. Hendo_67, Alex, and Wheeling to Freedom suggest management experiments. SQQQ Hold the Strike and Fearless Value supply loss and drawdown warnings. These labels describe supplied evidence, not independently verified current profitability. See `docs/quant/phase3_strategy_dna/EXPERT_REGISTRY.md` and `FAILURE_DNA.md`.

Extract hypotheses by separating entry, contract, timing, underlying, management, and execution. Test expert entry with a common exit, then a common entry with expert management. Include failed strategies and all attempted variants. Do not buy a trader's complete rule set on the strength of a leaderboard.

## Strategy routing

Keep one understandable baseline and distinct challengers. Proposed descriptive names must map to existing THETA-Q/H/D/A/C identifiers rather than create duplicate models.

| Branch | Purpose | Promotion discipline |
|---|---|---|
| Conventional Wheel | Cash-secured puts on acceptable underlyings, followed by state-dependent management | Baseline candidate, not automatically an empirically proven champion |
| Short-DTE hold-strike | Test assignment-aware short-dated economics | Challenger until independent OOS and operational evidence |
| Defined risk | Compare bounded-risk alternatives | Separate supported structure and evidence gate. Q=0 for a CSP alone is not evidence for a spread |
| Recovery | Manage actual assigned inventory | Compare continuing ownership, partial exit, full exit, and economically justified calls |
| Covered call | Rank stock-plus-call outcomes | Share coverage, event risk, retained upside, and exit preference all matter |

The router evaluates only permitted, sufficiently validated actions for the actual lifecycle state. It must be allowed to return WAIT. It must not combine every expert indicator into mandatory conditions or switch models impulsively after a losing streak. Fixed DTE and profit-taking schedules are benchmark policies, not universal laws.

## Entry, contract selection, and sizing

Sequence the actual decision as universe discovery, historical-data quality, ownership suitability, event and regime state, real listed contract enumeration, contemporaneous BBO, payoff and management scenarios, portfolio risk, cross-symbol comparison, and execution preflight.

Useful feature families include returns, trend, realized volatility, downside variation, gaps, liquidity, event distance, moneyness, DTE, Greeks, skew, term structure, and quoted spread. Delta is sensitivity, not the probability of a profitable managed episode. Flow and dealer-exposure estimates are contextual hypotheses, not guaranteed directional signals. Missing features retain UNKNOWN plus reason and source.

For a standard cash-secured put, gross assignment funding is `K*m*q`, where K is strike, m is the verified contract multiplier, and q is integer quantity. Actual reservation policy must incorporate broker rules without counting premium twice. An adjusted contract requires its actual deliverable, not an assumed 100-share lot.

Compute available allocation after existing lifecycle capital and opening-order reservations. Reconcile roll releases and replacements by state so capital is neither double-counted nor released before the old exposure is actually reduced.

`q = max(0, floor(min(q_collateral, q_risk, q_concentration, q_assignment, q_broker, q_user)))`

Each cap must have compatible contract units. Unknown mandatory caps block new risk. A user null overlay adds no restriction, while zero can forbid new entries. Platform and AEGIS limits remain active. Covered calls reserve unencumbered, confirmed shares, including shares already promised to working calls.

## Loss-management policy

The system needs a deterministic management path for every adverse state before it opens the corresponding exposure.

| State | Required assessment | Eligible response |
|---|---|---|
| Ordinary unrealized loss | Is the thesis intact and remaining value positive after costs? | Hold, reduce, close, or compare a roll |
| Expiry and gamma exposure | Remaining extrinsic value, strike proximity, session deadlines, assignment funding | Close, reduce, or deliberately retain exposure under policy |
| Earnings or event shock | Gap scenarios, ownership change, trustworthy event data | Reduce, exit, or wait according to the validated policy |
| Assignment | Actual broker shares and cash, delayed activity records, updated concentration | Reconcile, then evaluate recovery or exit |
| Ownership thesis failure | Prospective economics and alternatives | Exit or reduce, without waiting merely for accounting break-even |
| Recovery inventory | Recovery-time distribution, downside, capital lock, opportunity cost | Wait only while justified, sell stock, or sell an eligible covered call |
| Portfolio stress | Correlated losses and aggregate commitments | Stop new exposure and retain safe position management |
| Provider or reconciliation failure | What is known about current exposure and orders? | System hold for affected new risk, reconcile, and use only independently verified risk-reducing paths |

Use the canonical action-value model rather than a language model improvising trades:

`U(a|state) = E[future economic change after costs] - lambda*tail risk - kappa*capital-days - xi*execution risk`

Penalty units and model horizons must be explicit. Risk constraints remain hard constraints even if utility is high. Historical losses remain in the ledger but are sunk for comparing future alternatives at the same current state. Closing a losing trade can be economically correct. Waiting until the original entry price returns is not a valid thesis by itself.

No martingale, mechanical averaging down, revenge sizing, unlimited rolling, or mandatory post-assignment calls. A stop threshold cannot guarantee its fill price through a gap.

## Roll and covered-call accounting

`NetRollCashflow = new premium - old close debit - additional costs`

A positive roll cashflow can still extend a poor risk position. Compare the roll with hold, close, assignment, and redeployment from a common timestamp and common initial wealth. Preserve the close loss and a separate new exposure. Sequential and multileg execution need different partial-fill and recovery handling.

For assigned shares, evaluate the combined stock and call payoff. Premium alone omits stock downside and surrendered upside. A call below original basis can be rational if an exit is preferred, but must be disclosed as locking in a possible whole-chain loss. A call above basis can be unattractive if its premium cannot justify the risk and capital lock.

Broker-fill economic P&L equals realized and unrealized stock and option P&L, plus actual dividends and other attributable cashflows, minus costs not already embedded. Slippage is already embedded in actual fill prices relative to a benchmark. Do not subtract that same slippage again. For modeled or frictionless returns, include a separately defined execution-cost adjustment. Reconcile broker-reported equity and normalized economic metrics with explained differences.

`CapitalDays = integral(committed capital(t) dt)` in dollar-days.

`CapitalDayReturn = net P&L / CapitalDays` has units per day, not an annual investment return. Undefined or invalid denominators produce UNKNOWN rather than an attractive epsilon-driven ratio.

Expected shortfall should identify loss sign, horizon, confidence level, and scenario method. It is a tail estimate, not a maximum possible loss. Stress the total stock-option-pending-order portfolio, including gap, volatility, spread, event, assignment, and correlated inventory shocks.

## Models and validation

Use interpretable baselines already present in the quant project. Logistic models can estimate event probabilities, transparent scenario evaluators can compare actions, and empirical/survival models can represent recovery time. Tree/boosting methods are challengers when data supports them. HMMs or deep models need incremental evidence rather than architectural enthusiasm.

Require each model artifact to carry training cutoff, dataset hash, feature schema, target definition, version, calibration method, and cohort applicability. An unfitted model does not produce an authenticated probability merely because its function has a numeric output. LLMs can explain existing receipts and organize research, but cannot override order validation.

Unresolved inventory is censored data in recovery research, not a recovered winner and not an observation to discard. Cohort-specific calibration is important because probability quality can fail precisely in stressed regimes.

Validation proceeds through deterministic mechanics, point-in-time historical replay, purged walk-forward, untouched OOS, forward shadow, and diagnostic Paper operation. Paper mechanics tests and empirical evaluation answer different questions. Record all research trials. Bailey and Lopez de Prado explain why selection among many trials and non-normal returns inflate apparent performance, motivating Deflated Sharpe analysis rather than a best-backtest screenshot. [2]

Compare the full policy against simple delta/DTE policies, fixed take-profit benchmarks, expiry hold, random eligible entries, and versions without Optionomics, ownership, regime, router, or management layers. Evaluate both decisions and portfolio economics. A smaller model that performs better after costs should replace a larger one.

Do not fit a live fill-probability claim solely to Alpaca Paper fills. Alpaca documents omissions including market impact, latency slippage, queue position, regulatory fees, and dividends. It also describes simulated liquidity and partial-fill behavior. Keep broker Paper results and explicitly modeled cost adjustments separate. [3]

## Provider and deployment architecture

Keep TypeScript/Node for the existing control plane and customer APIs, Python for quant computation, Neon/PostgreSQL for durable truth, Redis for reconstructible hot state and coordination, Docker for deterministic services, and GitHub Actions for tests. Retain the existing modular frontend rather than rewriting working UI for fashion. Vercel hosts the product and request/response APIs. The approved topology still requires a supervised runtime worker for continuous management and broker streaming, separate from a browser or request lifetime.

Alpaca remains the source for broker accounts, executable market state, contracts, positions, orders, fills, and lifecycle activities. Optionomics remains research/context. Its documented authentication supports the email/token headers already used by the project. Version capability aliases against documented operations and entitlement results rather than inventing routes. [4]

Alpaca's latest quote documentation explicitly distinguishes official OPRA data from indicative data whose quotes are modified. An HTTP 200 is insufficient to label a quote production-grade. A prior OPRA entitlement failure needs a fresh check before activation. No new subscription or vendor is silently authorized by this report. [5]

Alpaca states that assignment events require REST polling rather than websocket delivery, and Paper non-trade activities may appear the following day. Reconciliation must tolerate this delay without declaring an economic zero, duplicating assignment, or confusing a provisional state with settled accounting. [6]

Reference repositories should stay small and purposeful: QuantLib for numerical cross-checks, QuantConnect LEAN for event-driven lifecycle patterns, and Alpaca's official SDK for supported API behavior. They are references, not evidence of a profitable strategy. Verify exact commit, license, dependencies, and security before reuse. No external code was imported in this milestone. [7][8][9]

## Master execution and follower copying

Persist a decision receipt and immutable order intent before the broker call. Validate the current account, exact Paper host, session, contract, deliverable, quote, quantity, funding, AEGIS, policy versions, and execution economics. Generate a deterministic account-specific client order identifier. Persist acknowledgements, consume order updates, and reconcile REST truth after interruption or ambiguous responses. A timeout does not prove an order failed.

Master fills produce deduplicated copy events. Every follower then applies its own funding, inventory, approval, quote, allocation, and execution checks. Never replicate the master quantity blindly. Track cumulative filled quantities so repeated or partial events cannot multiply follower exposure. Initial activation must not imply joining existing master positions.

Assignment is broker truth in each account. A master assignment must not fabricate a follower assignment. Follower stock/call state can diverge because positions, fills, exercises, or broker actions differ. Reconcile that account before mapping the next management action. A covered call can never be sent against shares a follower does not own.

Copying delegates strategy management, but cannot promise identical prices, quantities, assignments, or returns. Calculate follower results from follower cashflows. Stop New Copies retains management of existing copied exposure. Disconnect removes access without liquidation and must clearly explain who now manages open positions.

## Customer and operator experience

The customer chooses an amount, sees THETA-managed limits selected by default, and optionally expands extra account caps. Unset optional limits serialize to null. Custom fields validate only when enabled, including an explicitly meaningful zero where allowed. Every selected policy must survive save, reload, validation, and runtime enforcement.

The owner sees master account role, Paper environment, connection health, current exposure, decision freshness, worker health, reconciliation lag, and blockers. Customer pages show their own reconciled positions and economic results. Chain views show option, stock, roll, assignment, recovery, and call-away events with costs and reasons. Unknown stays unknown. No invented track record or misleading activation status is acceptable.

## Completion sequence and acceptance gates

1. Correct explicit account-role storage and uniqueness. Verify connected owner identity privately, forbid master self-copy, preserve encrypted credentials and OAuth interfaces.
2. Finish optional user-limit contracts, database representation, save/read APIs, and recommended-mode UI. Test zero/null/custom values and account isolation end to end.
3. Review Claude's completed R1 increments, reconcile overlapping calendar behavior, and run full integration tests. Do not duplicate active quant work.
4. Persist real snapshots, every candidate/WAIT/rejection, receipts, and version references. Replace manual production inputs and fixed capacities.
5. Operate a leased, restart-safe scheduler with reconciliation priority and observable heartbeats. Prove recovery after crashes before activating trading.
6. Complete explicit option position intents, price increment handling, collateral reservations, partial fills, cancel/replace, and assignment reconciliation.
7. Produce a fresh sanitized master readiness receipt. Activate diagnostic Paper execution only if every required gate passes under the owner's latest authorization.
8. Test master-fill-first copying with a distinct Paper account and independently reconciled positions. Keep followers locked until their own integration passes.
9. Accumulate forward evidence, calibrate, run OOS and ablations, and report unresolved losses. Live-small remains a future separately authorized release.

No trading threshold is changed to manufacture activity or a win-rate target. No production migration or execution flag is changed merely by documenting this sequence.

## Sources

1. Oleg Bondarenko, University of Illinois at Chicago, *Historical Performance of Put-Writing Strategies*, 2019, Cboe-supported research. https://cdn.cboe.com/resources/spx/bondarenko-oleg-putwrite-putw-2019.pdf
2. David H. Bailey and Marcos Lopez de Prado, *The Deflated Sharpe Ratio*, July 31, 2014. https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf
3. Alpaca, *Paper Trading*, accessed September 11, 2026. https://docs.alpaca.markets/us/docs/paper-trading
4. Optionomics, *API Key Management*, accessed September 11, 2026. https://docs.optionomics.ai/account/api-keys/
5. Alpaca, *Latest quotes*, accessed September 11, 2026. https://docs.alpaca.markets/us/reference/optionlatestquotes
6. Alpaca, *Options Trading*, accessed September 11, 2026. https://docs.alpaca.markets/us/docs/options-trading
7. QuantLib license and project. https://github.com/lballabio/QuantLib/blob/master/LICENSE.TXT
8. QuantConnect LEAN repository. https://github.com/QuantConnect/Lean
9. Alpaca official Python SDK. https://github.com/alpacahq/alpaca-py

Internal sources: the two owner directives attached September 11, 2026, current source files cited above, `docs/TEAM_CHARTER.md`, `docs/quant/phase3_strategy_dna/EXPERT_REGISTRY.md`, and `FAILURE_DNA.md`. This assessment supplements the canonical specifications and does not replace them.
