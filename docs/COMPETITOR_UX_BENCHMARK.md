# Competitive UX benchmark

Research date: 2026-09-09. Scope: public product pages, documentation, help content and accessible public screens. Audience: the product and engineering team. This is an independent design analysis, not an endorsement or a profitability comparison.

## Summary

Four useful patterns emerge: Alertsify makes user-specific execution constraints visible, QuantWheel organizes options into an ongoing Wheel workflow, Collective2 provides dense performance and scaling context, and Option Alpha connects automation outcomes to decision logs. Trading Bots combines these concepts around a complete economic chain, explicit evidence classes and a customer-safe separation from execution.

The primary opportunity is clarity about unresolved inventory, data provenance and the difference between configuration, simulation and a running trading service. These are acceptance-testable product improvements. No public research establishes that our trading performance is superior.

## Method and limits

We inspected official public material rather than private dashboards or proprietary source. Observations below are tied to specific sources. Weaknesses are our assessment of the observed surface, not a claim that a competitor lacks a capability throughout its product. Help pages can describe capabilities that require a paid account or entitlement. Authenticated trading, billing, broker linking and execution were not exercised. Public marketing claims of verification or returns were not independently audited.

There were no supplied competitor screenshot assets in the inspected repository. No logos, illustrations, text or visual identity were copied. The implementation uses original components and deterministic educational examples.

## Findings and design responses

### Alertsify

| Observed UX                                                                                                                                                                              | Why it works                                                                  | Weakness or limitation                                                                     | Our design response                                                                                                          | Decision |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| The public workflow describes copying after a leader's actual fill, then applying each follower's sizing and slippage constraints. It distinguishes a signal from the follower's result. | It gives the user a concrete cause-and-effect model.                          | A leader fill cannot prove a follower received the same price, size or assignment outcome. | Later copy execution must show each user's fills and skip reasons. Today the simulation explicitly has no broker connection. | IMPROVE  |
| My P&L replays closed fills with user settings.                                                                                                                                          | A personalized replay is easier to understand than a generic headline return. | Closed-fill replay alone is insufficient for a Wheel account with unresolved stock.        | Include open inventory MTM and whole-chain outcomes. Never label our input calculator a historical replay.                   | IMPROVE  |

Source: [Alertsify, How it works](https://alertsify.com/how-it-works).

| Observed UX                                                                                                                                                        | Why it works                                                            | Weakness or limitation                                                                          | Our design response                                                                                                                                                         | Decision        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Risk-control documentation covers daily loss, position risk, exposure, liquidity, spread, DTE, 0DTE and correlation constraints, with pause and skip explanations. | Controls are expressed in terms a user can understand before execution. | A large form can create false confidence if enforcement, units or failure behavior are unclear. | Group essential sizing before advanced preferences. Explicitly label recorded preferences as unenforced until a copy runtime exists. Quantity zero is an acceptable result. | BUILD / IMPROVE |
| Per-trader controls fit a trader-following marketplace.                                                                                                            | Users can isolate different sources of signals.                         | The marketplace model does not fit our owned-bot roadmap.                                       | List only our six strategy projects, without trader rankings, follower counts or social proof.                                                                              | REJECT          |

Source: [Alertsify, Copy trading risk controls](https://alertsify.com/blog/copy-trading-risk-controls).

Its [auto-execution disclosure](https://alertsify.com/auto-execution-disclosure) separates user instructions from independent trader behavior. Our interface makes an equally important boundary explicit: website production deployment does not enable trading.

### QuantWheel

| Observed UX                                                                                   | Why it works                                                                           | Weakness or limitation                                                                                    | Our design response                                                                                    | Decision        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------- |
| The public Wheel product page connects research, management, roll comparisons and journaling. | It treats selling a put as the beginning of a workflow rather than an isolated signal. | A seamless workflow can still leave the economics of assignment implicit unless users see the full chain. | Dedicated lifecycle detail links contracts, shares, cashflows, realized effects and current stock MTM. | BUILD / IMPROVE |

Source: [QuantWheel, Wheel strategy software](https://quantwheel.com/products/wheel-strategy-software).

| Observed UX                                                                                                  | Why it works                                                             | Weakness or limitation                                                                                                                                    | Our design response                                                                                                                                    | Decision         |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| The public review screen labels sandbox mode and offers CSP, covered-call and stock views with time filters. | Familiar lifecycle categories help options users find relevant exposure. | The public sandbox includes zero-filled summaries and foregone-income framing. These can be mistaken for known account results or pressure to sell calls. | Empty states distinguish no published feed from confirmed zero positions. Recovery wait is a first-class state, with no automatic covered-call prompt. | IMPROVE / REJECT |

Source: [QuantWheel, public Wheel review sandbox](https://quantwheel.com/dashboard/wheel/review). The observation is limited to this publicly accessible sandbox, not an authenticated account.

| Observed UX                                                                                             | Why it works                                                      | Weakness or limitation                                                              | Our design response                                                                                                                                            | Decision |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| The cost-basis calculator shows how premiums affect economic breakeven and includes a tax-basis caveat. | It gives a concrete explanation of premium and stock interaction. | Readers may conflate economic breakeven and broker acquisition basis when scanning. | Put both measures beside the chain, with a visible explanation. Our demo shows $180 acquisition price, $174.20 economic breakeven and a negative chain result. | IMPROVE  |
| The Wheel calculator provides scenario inputs and educational context.                                  | Users can explore assumptions without first connecting a broker.  | A scenario calculator can be mistaken for an expected return model.                 | Call ours an illustrative capital scenario. Show assignment losses, costs and explicit limitations next to the output.                                         | BUILD    |

Sources: [QuantWheel, cost-basis calculator](https://www.quantwheel.com/tools/cost-basis-calculator), [Wheel strategy calculator](https://www.quantwheel.com/tools/wheel-strategy-calculator).

### Collective2

| Observed UX                                                                                                                                                       | Why it works                                                                                     | Weakness or limitation                                                                         | Our design response                                                                                              | Decision           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------ |
| AutoTrade documentation describes proportional scaling, maximum size and automatic stop controls. Its example permits a scaled one-contract trade to become zero. | It explains discrete position sizing rather than assuming every subscriber can copy every trade. | Percentage scaling can obscure cash-secured option collateral and post-assignment capital use. | Use cash collateral and whole contracts in the illustration. Never round a zero result up to one.                | BUILD / IMPROVE    |
| Configuration includes whether to enter positions already in progress.                                                                                            | It exposes a consequential onboarding choice.                                                    | Joining mid-chain creates different economics and reconciliation requirements.                 | No join-existing support in this release. A later implementation needs explicit user-specific inventory lineage. | REJECT FOR PHASE 1 |

Source: [Collective2, AutoTrade configuration](https://support.collective2.com/hc/en-us/articles/202933834-AutoTrade-Configuration-Scaling-Max-Size-Auto-Stop-Loss). Different historical support surfaces showed differing scaling maxima, so no unverified platform-wide maximum is asserted here.

| Observed UX                                                                                                               | Why it works                             | Weakness or limitation                                                                                         | Our design response                                                                                                                                 | Decision |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Public strategy profiles expose hypothetical-performance labeling, drawdown, profit factor, win rate and monthly results. | Users can inspect more than raw profit.  | A large statistical surface can bury the distinction between resolved trades and unresolved economic exposure. | Five primary economic KPIs, then collapsible advanced statistics. Managed Episode WR gets context and independent N remains visible as unavailable. | IMPROVE  |
| Detailed performance disclosures describe costs, scaling and calculation assumptions.                                     | Definitions make results more auditable. | Footnote-heavy explanations can be missed during discovery.                                                    | Track Record & Data is a full panel, with inclusion flags for open positions, fees, slippage, stock MTM and assignment.                             | IMPROVE  |

Sources: [Collective2, public strategy profile](https://collective2.com/details/147357636), [Collective2, performance disclosures](https://twcfutures.collective2.com/new-highs). We do not reuse any competitor return figures or rank strategies.

### Option Alpha

| Observed UX                                                                                           | Why it works                                                       | Weakness or limitation                                                                          | Our design response                                                                                                                                       | Decision        |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Bot creation separates paper/live accounts, allocation, daily entry limits and total position limits. | Risk configuration is part of starting a bot, not an afterthought. | Users still need to understand what is counted and what happens to externally managed exposure. | Display environment independently from website status. Future enforcement must reconcile external positions rather than infer safety from local counters. | BUILD / IMPROVE |

Source: [Option Alpha, creating a bot](https://docs.optionalpha.com/getting-started/creating-a-bot).

| Observed UX                                                                   | Why it works                                                                                 | Weakness or limitation                                   | Our design response                                                                                                                 | Decision        |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Bot and automation logs let users inspect the decision path behind an action. | Drill-down makes automation explainable without filling the home page with technical detail. | A log is not automatically a complete accounting record. | Human-readable activity links to decision context and the economic chain. Snapshot references remain available in advanced details. | BUILD / IMPROVE |

Sources: [Option Alpha, Bots 101](https://optionalpha.com/bots-101), [automation logs](https://optionalpha.com/fast-track/automation-logs).

| Observed UX                                                                                       | Why it works                                                                                       | Weakness or limitation                                                   | Our design response                                                                                                                 | Decision |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Help material explains that expired broker authorization can interrupt automation and management. | It identifies a real operational failure rather than treating a connection as permanently healthy. | Users may equate an enabled bot with current broker access.              | Separate bot mode, automation state, broker availability and data freshness. A degraded or unknown feed never gets a healthy label. | BUILD    |
| Position-history export documentation explicitly excludes open positions.                         | Its export scope is documented.                                                                    | A closed-position file cannot alone reconstruct present economic equity. | Whole-chain and stock-MTM inclusion are explicit in published performance contracts.                                                | IMPROVE  |

Sources: [Option Alpha help](https://optionalpha.com/help), [position history export](https://optionalpha.com/blog/export-and-download-bot-position-history-data).

## Measurable product response

1. Every populated demo metric is labeled DEMO DATA, with a persistent banner on demo record pages.
2. Every published missing metric is null in the API and unavailable in the UI, never zero.
3. A negative assigned-stock example reduces economic P&L even when premium was positive.
4. All six roadmap entries have truthful availability. Five cannot simulate or activate.
5. A zero-capital scenario sizes zero contracts and never sends a broker request.
6. Chain detail is reachable directly from positions and history, with no giant modal.
7. API failures and stale, degraded, paused, closed-market and unavailable-broker states remain explicit.
8. Customer payloads contain no broker account identifiers, keys, headers or raw provider responses.
9. Browser tests cover desktop, tablet, mobile, keyboard and automated WCAG checks.
10. No allocation recommendations, performance ranking or copy activation appear without the corresponding validated backend.

## Research conclusion

Build the workflow and trust mechanisms, improve economic and operational transparency, and reject marketplace social proof, forced activity and return-led ranking. This release demonstrates the product experience with honest empty states and opt-in examples. It does not establish strategy profitability or readiness for customer capital.
