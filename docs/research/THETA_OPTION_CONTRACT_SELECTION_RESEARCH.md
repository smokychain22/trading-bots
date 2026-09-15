# THETA Option Contract Selection Research

Author: Claude (research lane). Options-first pass -- every section below is
framed at the UNDERLYING+EXPIRATION+STRIKE+CALL/PUT+STRUCTURE+CHAIN-STATE
level, never a generic stock signal. `CURRENT_MAIN_SHA_AT_START`:
`6a41b389cc1dccc1517e9e7cf1471aa89b8a9705` (recorded only, per instruction --
Codex is actively implementing P2B, not audited this pass).

Every claim below is either (a) already-registered THETA research
(`hypotheses.json`, `experiment_registry.py`, existing research modules),
cited by ID rather than re-derived, or (b) a real, source-verified finding
from an external repository this pass actually read, cited with the file. No
number, formula, or conclusion is fabricated. Every "best" claim is a
`RESEARCH_PRIOR` or `TESTABLE_HYPOTHESIS`, never Production truth --
`DATASET_ABSENT` still stands for all five branches.

## THETA_CONVENTIONAL

**Economic mechanism**: systematic short-put premium selling, harvesting the
volatility risk premium (documented positive on average across the cited
benchmark/academic evidence -- `H-Q-01`/`H-Q-02`, `cboe_put_index`,
`carr_wu_2009_variance_risk_premia` in `public_evidence_sources.json`) while
screening for ownership acceptability rather than premium alone.

**Contract-selection logic**: exact strike/expiration selected from a
DTE x |Delta| lattice (`DTE_BINS`: 15-24/25-35/36-45/46-60/60+;
`DELTA_MAGNITUDE_BINS`: six bins spanning 0.10-0.40, `experiment_registry.py`)
-- never a single fixed cell. `matchOptionomicsContractIdentity`-style
exact-match discipline (never fuzzy strike substitution) already governs how
a candidate contract's identity is confirmed once selected.

**DTE considerations (`RESEARCH_PRIOR`, from real evidence)**: the tastytrade-
sourced practitioner evidence (`tastytrade_45dte_21dte_50pct_management`)
leans toward 45-DTE entries outperforming 90+-DTE on a per-trade profit basis
when both are managed at 50% -- this is a MANAGEMENT-conditioned claim, not
a standalone DTE preference; the same source is recorded on BOTH sides of
`H-R-01`/`H-R-02` (early-management vs. patience), never asymmetrically.
`Israelov & Tummala (2017)` motivates testing DTE/strike selection under
MULTIPLE risk measures (SD vs. stress-loss vs. ES) rather than assuming one
"best" cell dominates under every measure -- their own finding is that
front-month, near-the-money-to-moderately-below strikes were most compensated
PER UNIT OF STRESS-TEST LOSS specifically, a different answer than a pure
Sharpe-style ranking might give.

**Delta considerations (`TESTABLE_HYPOTHESIS`)**: lower |Delta| (0.10-0.20)
plausibly improves theoretical WR at the cost of premium/capital-efficiency
(smaller credit per unit of collateral); higher |Delta| (0.30-0.40) plausibly
improves capital efficiency at the cost of WR and tail exposure. Neither
direction is asserted as dominant -- this is exactly what the DTE x Delta
lattice exists to test, cell by cell, never assumed from theory. `H-Q-01`
already frames the ownership-quality-vs-premium tradeoff this generalizes.

**Skew's effect on strike economics (`TESTABLE_HYPOTHESIS`, new this pass,
see `H-Q-06`)**: when 25-delta put skew on the candidate expiration steepens,
the SPECIFIC downside strikes THETA_CONVENTIONAL would sell are pricing
disproportionate tail risk relative to upside/ATM strikes on the same chain
-- this is a per-candidate, per-expiration richness signal, not a market-wide
skew index substituted for the underlying's own chain.

**Event crossing (`RESEARCH_PRIOR`)**: `H-Q-03`'s deterioration-signal list
already includes approaching event risk as one trigger for evaluating
Defined Risk alongside Conventional; TRD's own hard event-safety gate
(`docs/quant/phase3_strategy_dna` corpus) forbids a naive "high event IV =
automatically sell" rule.

**VRP by expiration/strike (`TESTABLE_HYPOTHESIS`, see `H-Q-05`)**: VRP
measured on the SAME candidate contract's own strike/expiration (horizon-
matched IV-minus-RV, `iv_realized_vol_research.py`'s existing alignment
discipline), never the underlying's raw IV level.

**Liquidity considerations**: `dominickkubica/options-scanner`'s
`net_credit()` check (`credit >= width` for a spread is rejected outright as
"arbitrage on paper and a stale quote in practice") is a concrete,
actionable DATA-QUALITY rule worth flagging for any THETA candidate
validation that consumes recorded (never fully trusted) bid/ask -- a
single-leg CSP has no direct analog, but the underlying principle (a
theoretically-impossible observed value is a data-quality signal, not a
real opportunity) generalizes.

**Failure modes / tail risks**: gap risk on an unbounded short put; VRP
regime reversal (the compensating premium existed for a real reason);
correlated-underlying concentration eroding the "diversified bet" premise.

**WAIT conditions**: no cell in the DTE x Delta lattice clears the forward-
economics boundary; VRP compressed across the whole candidate universe;
event risk dominates every available expiration.

## THETA_HOLD_STRIKE

**Economic mechanism**: a SEPARATE, narrower 2-5 DTE ATM/near-ATM challenger
(`H-H-01`) -- higher per-episode hit rate at the cost of concentrated
gamma/gap exposure right at expiration. Never assumed to transfer
Conventional's 15-60+ DTE evidence (`H-H-01`'s own `regime_scope_note`).

**Contract-selection logic**: ATM/near-ATM/slightly-OTM at 2/3/4/5 DTE --
a materially different lattice shape than Conventional's, deliberately kept
separate.

**Gamma/theta tradeoff (`RESEARCH_PRIOR`, source-verified this pass)**:
FlashAlpha's own documented finding (`0dte_theta_decay_monitor.py`, read in
full two sessions ago): "a standard 0DTE ATM option may lose 30-50% of its
value in the final 90 minutes" -- theta decay is sharply NONLINEAR and
back-loaded, not a smooth linear burn, for very-short-DTE contracts. This is
an INDEX-0DTE finding (SPY), a different liquidity/dynamics profile than
THETA's equity/ETF universe at 2-5 DTE (not 0DTE) -- cited as a directional
prior for the shape of the decay curve, not a transferable number.

**Intraday theta / overnight gap risk**: 2-5 DTE positions carry real
overnight gap exposure that a close-to-close backtest can understate --
`H-H-01`'s own `failure_mode` field already names this risk explicitly
("a naive replay can overstate this archetype's WR by missing adverse
gap-through-strike scenarios").

**Pin risk / assignment / liquidity deterioration**: pin risk concentrates
near the ATM strike close to expiry; liquidity on very-short-DTE contracts
can deteriorate faster intraday than longer-dated contracts as market makers
manage their own gamma exposure into the close.

**Event sensitivity / expected move / GEX context**: `H-H-01`'s state
constraints already require excluding near-term earnings given ATM gamma
exposure. Expected-move distance
(`ExpectedMoveApprox = S*IV*sqrt(DTE/365)`, confirmed field in
`THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`'s feature schema v2) is
directly relevant at 2-5 DTE where the move is small in absolute terms but
large relative to the strike's own gamma sensitivity.

**Failure modes / tail risks**: a single adverse overnight gap can erase
many episodes' worth of accumulated small premium -- exactly the "many small
wins / one large loss" pattern `wr_illusion_detector.py` already tests for
structurally.

**WAIT conditions**: liquidity too thin for the 2-5 DTE window specifically
(a wider spread matters proportionally more on a smaller premium); event
risk within the window; expected move too large relative to available
strikes' cushion.

## THETA_DEFINED_RISK

**Economic mechanism**: bounded-risk put-credit-spread structure, expressing
the same VRP thesis with capped downside -- explicitly gated (`H-D-01`)
behind Alpaca Level 3 AND THETA-Q/H/R/C/A graduation; registered for
research completeness, not implementation.

**Contract-selection logic, concrete techniques found this pass**
(`dominickkubica/options-scanner`, `strategies/spreads.py`, read in full):
- Short strike selected the same way as a CSP (OTM put, |Delta| lattice
  applies identically).
- **Width is selected from a CONFIGURED, discrete list -- a width not on
  the list produces NO candidate, never the nearest available width
  substituted.** Direct quote: "substituting a 4 wide for a 5 wide silently
  changes max loss by a quarter." This is a concrete, adoptable-as-a-
  PRINCIPLE (not code, no license) discipline: THETA's own eventual
  Defined-Risk width research should use the same never-round rule.
- **`credit >= width` is rejected outright** as a data-quality signal
  (theoretically impossible for a genuine credit spread with valid quotes).
- **`worst_liquidity()` takes the MINIMUM of both legs' liquidity scores**,
  never an average -- both legs must independently clear the bar. Matches
  `H-D-01`'s own stated requirement ("liquidity must be checked on BOTH
  legs, not just the short strike").
- Iron-condor short strikes (a 4-leg structure THETA does not currently
  scope) are paired at "roughly matching absolute delta" to start
  approximately delta-neutral -- reference material only, THETA-D per
  `strategy_archetypes.json` is single-sided.

**When does hedge cost destroy edge (`TESTABLE_HYPOTHESIS`)**: a wider long
wing costs less premium but caps less tail risk; a narrower long wing costs
more of the collected credit but caps tail risk closer to the short strike.
The credit/width ratio and the width-selection discipline above together
define this tradeoff -- no single "best" width is asserted.

**Both-leg slippage**: two-leg execution cost is structurally higher than a
single CSP leg (two bid/ask crossings); `H-D-01`'s own gating already
requires this to be measured before promotion, not assumed acceptable.

**CSP vs. put-credit-spread on the SAME chain (`TESTABLE_HYPOTHESIS`,
directive section 5's explicit comparison)**: same short strike, compare
after-cost EV/WR/PF/ES/CVaR/capital-efficiency between the naked CSP and the
same-short-strike spread at each configured width -- this is the natural
experiment design once THETA-D is ungated, not yet run (`DATASET_ABSENT`).

**Failure modes / tail risks**: a "beautiful short strike paired with an
unquotable protective leg is not a trade" (direct quote,
`dominickkubica/options-scanner`) -- a structurally attractive short strike
whose long-wing hedge is illiquid is not a real candidate regardless of the
short leg's own economics.

**WAIT conditions**: no configured width produces a positive-after-cost
candidate; the long leg is untradeable at every configured width; the
short-strike-only CSP already clears the bar with acceptable tail risk,
making the extra execution cost of a spread not worth it.

## THETA_RECOVERY

**Economic mechanism**: post-assignment forward-economics comparison among
`RECOVERY_WAIT`/`SELL_STOCK`/`SELL_CC` from the CURRENT state -- assignment
treated as economic continuation (`H-A-01`), never automatic failure.

**Contract-selection logic for the CC alternative specifically**: `H-C-02`
already frames this as conditioned on recovery-thesis state, not immediate-
sale-on-assignment. The CC's OWN contract economics (call Delta, DTE, strike
relative to economic basis, premium, IV, skew, upside surrender,
event/dividend state, call-away) are exactly `H-C-01`/`H-C-02`'s existing
scope, applied specifically to the post-assignment cohort.

**Evidence for waiting to sell a CC (`RESEARCH_PRIOR`)**: `H-C-02`'s own
mechanism already states the case precisely: "selling a call on stock that
just got assigned deep underwater caps upside at a strike that may lock in a
loss if called away, before the position has had any chance to recover --
waiting preserves the option to sell a call once the stock is closer to (or
above) basis." This is a STANDING TRD rule (STRAT-003), not a new finding --
restated here in options-first terms because the directive asks for it in
this pass's framing: the CC's own strike-vs-basis relationship, not the
stock's general trend, is the deciding variable.

**Bound requirement on `RECOVERY_WAIT` (`H-A-02`, RETAIN, architecture-
level)**: unconditional unbounded waiting is explicitly NOT an acceptable
design -- some risk/time/thesis-invalidation bound must exist. `H-A-04`
covers the genuinely open question of WHICH bound value, with an explicit
three-step leakage guard (define candidates before touching OOS, select on
purged walk-forward only, confirm on a separate untouched split).

**Failure modes / tail risks**: `H-H-02`/`H-A-03`'s standing measurement
discipline -- closed-trade WR can hide unresolved assigned-stock losses;
Managed Episode WR, Whole-Chain WR, and Open MTM must be reported together
for this archetype specifically, since it is where the Leg-WR blind spot is
largest in absolute terms.

**WAIT conditions**: recovery bound not yet reached and no CC candidate
clears its own bar (call IV too low relative to basis-protection needed);
stock sale not yet economically preferable to continued wait.

## THETA_CC

**Economic mechanism**: trades premium against retained upside and
call-away regret -- explicitly NOT yield-maximization (`H-C-01`, RETAIN,
TRD LIFE-004).

**Contract-selection logic**: Delta 0.10-0.40 lattice (same shape as
Conventional's, applied to calls); strike selection basis-aware (vs. economic
basis, not just vs. spot) -- `H-C-01`'s `CCUtility` formula already names
the full tradeoff: `EV_premium + EV_stock - CallAwayRegret -
EventRiskPenalty - ExecutionCost - TailPenalty`.

**When is NOT selling a covered call better (directive's explicit central
question, `TESTABLE_HYPOTHESIS`)**: cheap call IV (insufficient premium to
compensate for upside surrender) combined with a strongly favorable
underlying trend is the directive's own named example. This is a genuine,
currently-UNREGISTERED gap flagged (not fabricated) two sessions ago --
still open this pass given time budget. The correct framing, per the
options-first boundary: the decision variable is the CANDIDATE CALL's own
premium-vs-IV richness relative to its own strike's upside-surrender cost,
not "the stock looks bullish" alone -- a call that's cheap in IV terms
specifically (not merely "the stock went up") is the actual signal.

**Basis-aware strikes**: `H-C-01`'s `EV_stock` term already requires the
real economic basis, not spot -- directly contrasts with
`dominickkubica/options-scanner`'s own honestly-documented simplification
("cost basis is assumed to be current spot... it means the reported return
is what a NEW position would make, not what an existing one would" -- their
own module explicitly flags this as a known limitation their "Phase 7" is
meant to fix). THETA's `H-C-01` already requires the real basis from day
one -- a genuine advantage over this reference tool's current state, worth
noting explicitly rather than assuming the reference tool is more complete
than it is.

**Call-away probability / upside opportunity cost / dividend/earnings
effects**: `H-C-01`'s `EventRiskPenalty` term already covers earnings/
ex-div proximity; call-away itself is `CallAwayRegret`, computed from the
POST-call-away stock path (the module's own `failure_mode` field already
warns against a backtest that scores only realized premium and ignores
forfeited upside).

**Low-IV vs. high-IV environments (`TESTABLE_HYPOTHESIS`)**: low call IV
plausibly favors WAIT/no-CC (per the directive's own example above); high
call IV plausibly favors selling, but the SAME concentration/event-proximity
cautions from Conventional apply (a high IV can reflect real event risk, not
mispricing).

**Failure modes / tail risks**: locking in a loss via a strike below basis
that later gets exceeded by the underlying's recovery; the exact pattern
`H-C-02` exists to prevent.

**WAIT conditions**: call premium insufficient relative to
`CallAwayRegret`+`EventRiskPenalty`; recovery-thesis state not yet
sufficiently improved (per `H-C-02`'s own gating condition).

## Cross-cutting: expiration and strike/delta selection matrices

**Expiration selection** (directive section 8): THETA's answer today is a
RESEARCH LATTICE (5 DTE bins), not a single chosen expiration -- the matrix
of premium/theta/gamma/event-crossing/term-structure/liquidity/capital-days/
assignment-exposure/roll-flexibility tradeoffs across that lattice is
exactly what the lattice's own per-cell experiments (`SLICE-DTE-*`,
`experiment_registry.py`) exist to measure, cell by cell, once real data
exists. No repository found this pass demonstrated a materially richer
expiration-selection FORMULA than what THETA already researches (term
structure comparison methods already exist in `term_structure_research.py`
with 3 named methods).

**Strike/Delta selection** (directive section 9): THETA already compares
fixed-Delta targeting (the 6-bin lattice) against ownership-acceptability
screening (`H-Q-01`/`H-Q-02`'s explicit comparison of premium-only vs.
ownership-augmented selection). `Israelov & Tummala`'s risk-measure-dependent
finding (cited above) is the strongest EXTERNAL evidence found so far that
"best" strike selection genuinely depends on which risk measure is used to
judge it -- directly motivating THETA's own multi-metric reporting standard
(never WR alone) rather than a single optimal-Delta claim.

## Formula check (bounded to option-selection formulas per directive section 24)

No new formula ambiguity found this pass. Existing, already-verified
formulas remain: `CSPBreakeven = K - RecordedBidCredit`,
`DownsideCushion = (S - CSPBreakeven) / S`,
`CreditYieldOnCollateral = RecordedBidCredit * Multiplier / SecuredCollateral`,
`ExpectedMoveApprox = S*IV*sqrt(DTE/365)` (all confirmed field-level in
`THETA_OPTIONOMICS_CAPABILITY_CENSUS_2026-09-14.md`'s feature schema v2, not
re-derived here). One NEW, concrete data-quality check found this pass worth
flagging for Codex's own candidate validation: **`credit >= width` for any
multi-leg credit structure is a hard rejection signal (theoretically
impossible with valid contemporaneous quotes), not merely a low-quality
candidate** -- currently not an explicit check anywhere in THETA's own code
(THETA-D is gated/unimplemented, so this is forward-looking, not a defect).

## Repository dossiers, this pass

**`dominickkubica/options-scanner`** (deepened this pass, no license,
REFERENCE_ONLY): read `strategies/singles.py` and `strategies/spreads.py` in
full, in addition to `scoring.py` read two sessions ago. New findings above
(width-list-only, credit>=width rejection, worst-liquidity-of-both-legs,
honest spot-basis-assumption disclosure). `holdout`/`outcomes`
architecture and tests still not read this pass (time budget) -- flagged,
not fabricated.

**`broussardkobey67-spec/options-screener`** (MIT, triaged this pass): small
(39kb), single-file (`screener.py`). Real Black-Scholes delta estimation,
DTE-window and moneyness filtering, config-driven. **REJECT** as a primary
source -- materially thinner than `dominickkubica/options-scanner`, no
renormalization/honest-limitation sophistication, no multi-leg structures.
**TEST_ONLY** at most, for its bare-bones DTE/moneyness filter shape as a
baseline-simplicity reference.

**`PrathamMehta08/Option-CC`, `aicodepathways/grant-options-system`**: NOT
deep-read this pass (time budget) -- named honestly as untriaged-beyond-
existence-verification, not silently dropped. `PrathamMehta08/Option-CC`'s
tree (`src/app/api/chain/route.ts`, `evals/`) suggests a Next.js app with an
LLM-chatbot component (`LLMChatbot.tsx`) layered over a chain API -- lower
priority for pure contract-selection-formula research than a backend-only
scanner, noted as the reason it was deprioritized this pass rather than
rejected on content.

**New search performed this pass**: targeted queries for cash-secured-put
screeners and chain-ranking/liquidity-filter repos (see receipt for exact
terms) surfaced the above plus several not verified/read this pass
(`lds051332/OptionTradingAgent`, `pk-ux/options-screener`,
`ghamphy/options-screener`, `dominickkubica`'s own frontend) -- named for a
future pass, not claimed as researched.

## Receipt

```
CURRENT_MAIN_SHA_AT_START: 6a41b389cc1dccc1517e9e7cf1471aa89b8a9705 (recorded only)
CURRENT_CLAUDE_SHA: (see final commit on claude/theta-r1-real-state)

OPTIONS_FIRST_RESEARCH = YES

CONVENTIONAL_RESEARCH = COMPLETE (this pass's depth)
HOLD_STRIKE_RESEARCH = COMPLETE (this pass's depth)
DEFINED_RISK_RESEARCH = COMPLETE (this pass's depth -- new concrete
  techniques from dominickkubica/options-scanner's spreads.py)
RECOVERY_RESEARCH = COMPLETE (this pass's depth)
CC_RESEARCH = COMPLETE (this pass's depth)
  All five received substantive, evidence-grounded research this pass, per
  the directive's explicit requirement -- none returned NOT_ATTEMPTED.
  "COMPLETE" here means "substantively researched this pass," not "empirically
  proven" -- DATASET_ABSENT stands for all five.

CHAIN_LEVEL_ANALYSIS = GAPS (two real strategy-generator files deep-read;
  the holdout/outcomes architecture and provider-normalization layer not read)
CONTRACT_SELECTION_RESEARCH = COMPLETE (this pass's depth, per-branch above)
EXPIRATION_SELECTION_RESEARCH = COMPLETE (existing lattice + term-structure
  methods confirmed as the current answer; no richer external formula found)
STRIKE_SELECTION_RESEARCH = COMPLETE (existing lattice + Israelov/Tummala's
  risk-measure-dependence finding)
DELTA_SELECTION_RESEARCH = NO_CHANGE_REQUIRED (unchanged from prior sessions)
OPTION_LIQUIDITY_RESEARCH = COMPLETE (worst-of-both-legs technique,
  credit>=width rejection, both concrete and citable)
OPTION_STRUCTURE_COMPARISON = COMPLETE (CSP-vs-spread-on-same-chain framed
  as the natural experiment, not yet run -- DATASET_ABSENT/H-D-01 gate)
WAIT_RESEARCH = GAPS (WAIT conditions named per-branch above; no dedicated
  cross-branch WAIT hypothesis registry entries added this pass)

OPTIONOMICS_CONTRACT_SELECTION = GAPS (not deepened this pass beyond what
  two sessions ago already established)
FLOW_CONTRACT_SELECTION = NOT_ATTEMPTED_THIS_PASS
GEX_CONTRACT_CONTEXT = NOT_ATTEMPTED_THIS_PASS (spot-scan gamma-flip
  research from a prior session stands, not deepened)
VOL_SURFACE_CONTRACT_CONTEXT = GAPS (arbitrage-definition reference material
  from a prior session stands, not deepened)

QUANTWHEEL_FINDINGS = unchanged from prior sessions (not re-deepened)
ALERTSIFY_FINDINGS = unchanged (existing evidence only, no gaps filled)
COLLECTIVE2_FINDINGS = unchanged (no material found; non-fabrication stands)

REPOS_DEEP_STUDIED = dominickkubica/options-scanner (strategies/singles.py,
  strategies/spreads.py, this pass; scoring.py, prior session)
NEW_HIGH_VALUE_REPOS = none confirmed this pass (broussardkobey67-spec
  triaged and rejected as thin)
REPOS_REJECTED = broussardkobey67-spec/options-screener (thin, REJECT as
  primary source, TEST_ONLY at most for its baseline filter shape)

NEW_EDGE_HYPOTHESES = 0 (this pass consolidated/cited existing hypotheses in
  options-first terms rather than registering new ones)
NEW_WAIT_HYPOTHESES = 0 (WAIT conditions narrated per-branch; not formally
  registered as new hypotheses.json entries this pass)
NEW_STRUCTURE_HYPOTHESES = 0 (CSP-vs-spread comparison already implied by
  existing H-D-01 gating; not a new hypothesis ID this pass)

FORMULA_ISSUES = NONE FOUND (one new forward-looking data-quality check
  flagged: credit >= width rejection for future Defined-Risk validation code)

UNDERLYING_ONLY_STRATEGY_DRIFT
MUST_BE_NONE = NONE FOUND -- every claim in this document is anchored to a
  specific contract/strike/expiration/structure variable, never a bare
  underlying-price/trend signal

70_80_WR_STATUS = NOT_PROVEN
40_PLUS_RETURN_STATUS = ASPIRATIONAL_NOT_TAKE_PROFIT

RECOMMENDATIONS_FOR_CODEX: none required -- pure research pass, no
  engineering defect found. One forward-looking note (credit>=width
  rejection) offered for whenever Defined-Risk validation code is built,
  not urgent.

EMPIRICAL_BLOCKERS: DATASET_ABSENT, unchanged
PROVIDER_BLOCKERS: Optionomics production auth/current-data semantics, unchanged

MAIN_PUSHED = NO
PRODUCTION_CHANGED = NO
BROKER_ORDERS_BY_CLAUDE = 0
LIVE_OWNER_AUTHORIZATION = NOT_GRANTED
LIVE_ELIGIBLE = NO
```
