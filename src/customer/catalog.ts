import type {
  BotSummary,
  BotDetail,
  Evidence,
  Metric,
  BotEquityPoint,
} from "./models.js";

const metric = (
  label: string,
  technical_name: string,
  unit: Metric["unit"],
  explanation: string,
  value: number | null = null,
): Metric => ({
  label,
  technical_name,
  unit,
  explanation,
  value,
  reason: value === null ? "No validated record published" : null,
});
const catalog = [
  [
    "theta",
    "Premium Income",
    "Income",
    "An assignment-aware Wheel that evaluates cash-secured puts, stock recovery, and covered calls.",
    "Lifecycle",
    "Cash-secured puts · Stock ownership · Covered calls",
  ],
  [
    "atlas",
    "Directional Swing",
    "Directional",
    "Defined-risk directional swing strategies across changing market conditions.",
    "Days",
    "Defined-risk spreads",
  ],
  [
    "nexus",
    "Neutral Premium",
    "Neutral",
    "Research into neutral index strategies for range-bound markets.",
    "Weeks",
    "Index options · Range strategies",
  ],
  [
    "vega",
    "Volatility Relative Value",
    "Volatility",
    "Research into relative value across volatility structures.",
    "Weeks",
    "Volatility · Relative value",
  ],
  [
    "event",
    "Catalyst Repricing",
    "Event",
    "Research into how scheduled catalysts reprice options.",
    "Days",
    "Scheduled events",
  ],
  [
    "pulse",
    "Intraday Directional",
    "Intraday",
    "Research into intraday and 0DTE directional opportunities.",
    "Intraday",
    "Intraday · 0DTE",
  ],
] as const;

export function botSummaries(): BotSummary[] {
  return catalog.map(([id, category, strategy, description, holding]) => ({
    bot_id: id,
    name: id.toUpperCase(),
    category,
    strategy,
    description,
    holding,
    strategy_version: id === "theta" ? "theta-q-v0 / research baseline" : null,
    environment: id === "theta" ? "PAPER" : "RESEARCH",
    as_of: null,
    data_quality: "UNKNOWN",
    provenance: id === "theta" ? "PAPER" : "RESEARCH",
    risk: "UNRATED",
    risk_explanation:
      "Risk classification has not been validated. Options and assigned stock can incur substantial losses.",
    capital_minimum: null,
    instruments:
      id === "nexus"
        ? ["Index Options"]
        : id === "theta"
          ? ["Stocks", "Options"]
          : ["Options"],
    available: id === "theta",
    status: {
      mode: id === "theta" ? "PAPER" : "RESEARCH",
      automation: id === "theta" ? "NOT_ENABLED" : "RESEARCH",
      aegis: "UNKNOWN",
      last_decision: null,
      last_fill: null,
      current_exposure: null,
      market_session: "UNKNOWN",
      regime: "UNKNOWN",
      activation_allowed: false,
      copy_available: false,
      simulation_available: id === "theta",
    },
    metrics: [
      metric(
        "Economic P&L",
        "Whole-Chain P&L",
        "USD",
        "Includes options, stock mark-to-market, dividends and costs.",
      ),
      metric(
        "Profit factor",
        "Profit Factor",
        "RATIO",
        "Gross economic wins divided by absolute economic losses.",
      ),
      metric(
        "Max drawdown",
        "Maximum Drawdown",
        "PERCENT",
        "Largest peak-to-trough economic equity decline.",
      ),
      metric(
        "Episode win rate",
        "Managed Episode WR",
        "PERCENT",
        "Resolved economic episodes only. Assigned stock stays unresolved.",
      ),
    ],
  }));
}

export function botDetail(id: string, demo = false): BotDetail | null {
  const bot = botSummaries().find((item) => item.bot_id === id);
  if (!bot) return null;
  const fixture = demo && id === "theta";
  const evidence: Evidence = {
    bot_id: id,
    strategy_version: bot.strategy_version,
    environment: bot.environment,
    as_of: fixture ? "2026-08-31T20:00:00.000Z" : null,
    data_quality: fixture ? "GOOD" : "UNKNOWN",
    provenance: fixture ? "DEMO_DATA" : bot.provenance,
  };
  const base = fixture
    ? bot.metrics.map((m, i) => ({
        ...m,
        value: [3950, 16500 / 10630, null, 60][i] ?? null,
        reason: null,
      }))
    : bot.metrics;
  const inventory = metric(
    "Open inventory MTM",
    "Unrealized stock P&L",
    "USD",
    "Open assigned-stock gains and losses remain in economic equity.",
    fixture ? -2500 : null,
  );
  const equity: BotEquityPoint[] = fixture
    ? [
        [0, 0, 0],
        [2200, 2400, 12000],
        [800, 2700, 16000],
        [-1900, 2800, 18000],
        [-800, 3500, 18000],
        [900, 4000, 18000],
        [2400, 4800, 18000],
        [3100, 5700, 18000],
        [2000, 5800, 18000],
        [3500, 6250, 18000],
        [2900, 6300, 18000],
        [3950, 6450, 18000],
      ].map(([p = 0, r = 0, c = 0], i, arr) => ({
        date: `2026-${String(Math.floor(i / 4) + 6).padStart(2, "0")}-${String([7, 14, 21, 28][i % 4]).padStart(2, "0")}`,
        total: 100000 + p,
        realized: r,
        unrealized: p - r,
        benchmark: null,
        capital_utilized: c,
        drawdown:
          ((100000 + p) /
            Math.max(...arr.slice(0, i + 1).map((v) => 100000 + (v[0] ?? 0))) -
            1) *
          100,
      }))
    : [];
  if (fixture) {
    const dd = base.find((m) => m.technical_name === "Maximum Drawdown");
    if (dd) dd.value = Math.min(...equity.map((p) => p.drawdown));
  }
  const positions = fixture
    ? [
        {
          ...evidence,
          chain_id: "demo-aapl-001",
          symbol: "AAPL",
          lifecycle_state: "RECOVERY_WAIT",
          position: "100 assigned shares",
          cost_basis: 180,
          current_price: 155,
          collateral: 18000,
          premium_collected: 600,
          stock_mtm: -2500,
          whole_chain_pnl: -1920,
          dte: null,
          aegis: "Demo: HOLD_ONLY",
          next_action:
            "Evaluate recovery, stock exit and covered-call alternatives",
        },
      ]
    : [];
  const events = fixture
    ? [
        {
          timestamp: "2026-07-06T15:30:00Z",
          action: "OPEN_CSP",
          contract: "AAPL260807P00180000",
          underlying: "AAPL",
          option_price: 6,
          cashflow: 600,
          realized_pnl: 0,
          unrealized_pnl: 0,
          reason:
            "Synthetic opening put used to illustrate assignment accounting.",
          strategy_version: "demo-wheel-v1",
        },
        {
          timestamp: "2026-08-07T21:00:00Z",
          action: "ACCEPT_ASSIGNMENT",
          contract: "AAPL260807P00180000",
          underlying: "AAPL",
          option_price: null,
          cashflow: -18000,
          realized_pnl: 600,
          unrealized_pnl: -2500,
          reason:
            "Synthetic assignment. 100 shares at $180; premium remains in chain.",
          strategy_version: "demo-wheel-v1",
        },
        {
          timestamp: "2026-08-31T20:00:00Z",
          action: "RECOVERY_WAIT",
          contract: null,
          underlying: "AAPL",
          option_price: null,
          cashflow: -20,
          realized_pnl: -20,
          unrealized_pnl: -2500,
          reason:
            "Synthetic combined fees and slippage of $20. No immediate covered call assumed. Chain: $600 - $20 - $2,500 = -$1,920.",
          strategy_version: "demo-wheel-v1",
        },
      ]
    : [];
  return {
    ...bot,
    ...evidence,
    metrics: base,
    tags:
      id === "theta"
        ? ["Cash-secured puts", "Assignment", "Recovery", "Covered calls"]
        : [bot.strategy, "Coming later"],
    performance: {
      ...evidence,
      metrics: [...base, inventory],
      advanced: [
        metric(
          "Whole-chain win rate",
          "Whole-Chain WR",
          "PERCENT",
          "Resolved complete Wheel chains.",
        ),
        metric(
          "Leg win rate",
          "Leg WR",
          "PERCENT",
          "Option legs alone. Does not describe full economic outcomes.",
        ),
        metric(
          "Average win",
          "AvgWin",
          "USD",
          "Average resolved economic gain.",
          fixture ? 5500 : null,
        ),
        metric(
          "Average loss",
          "AvgLoss",
          "USD",
          "Average absolute resolved economic loss.",
          fixture ? 5315 : null,
        ),
        metric(
          "After-cost expectancy",
          "EV net",
          "USD",
          "Requires validated outcome probabilities and all costs.",
        ),
        metric(
          "Capital-day return",
          "Capital-Day Return",
          "RATIO",
          "Economic P&L per unit of capital committed over time.",
        ),
        metric(
          "Worst-case loss estimate",
          "Expected Shortfall 5%",
          "USD",
          "Average loss in the worst 5% of outcomes. Requires sufficient evidence.",
        ),
        metric(
          "Independent samples",
          "Effective independent N",
          "COUNT",
          "Adjusts raw episode count for dependence.",
        ),
        metric(
          "Typical recovery",
          "Median recovery duration",
          "DAYS",
          "Time from assignment to economic resolution.",
        ),
        metric(
          "Long recovery",
          "P95 recovery duration",
          "DAYS",
          "95th percentile recovery duration.",
        ),
        metric(
          "Calibration quality",
          "Brier score",
          "RATIO",
          "Squared probability forecast error, lower is better.",
        ),
        metric(
          "Prediction loss",
          "LogLoss",
          "RATIO",
          "Probabilistic forecast loss.",
        ),
        metric(
          "Assignment rate",
          "Assignment rate",
          "PERCENT",
          "Assignments divided by eligible resolved put exposures.",
        ),
        metric(
          "Execution slippage",
          "TCA slippage",
          "USD",
          "Execution deviation from a named benchmark, not midpoint fill assumptions.",
        ),
      ],
      track_record: {
        ...evidence,
        source: fixture
          ? "Deterministic educational fixture v1"
          : "No customer performance feed published",
        start_date: fixture ? "2026-06-07" : null,
        live_duration_days: null,
        paper_duration_days: null,
        resolved_episodes: fixture ? 5 : null,
        independent_n: null,
        open_positions_included: fixture ? true : null,
        fees_included: fixture ? true : null,
        slippage_included: fixture ? true : null,
        stock_mtm_included: fixture ? true : null,
        assignment_included: fixture ? true : null,
        limitation: fixture
          ? "DEMO DATA. Five synthetic resolved episodes: three wins totaling $16,500, two losses totaling $10,630. Resolved P&L $5,870 plus $580 realized on the open chain and -$2,500 stock MTM equals $3,950. Not a backtest, paper record, forecast or independent sample."
          : "No live, paper, or untouched OOS track record is available. Broker authentication is not performance verification.",
      },
      equity,
      monthly: fixture
        ? [
            { month: "2026-06", return_pct: -1.9 },
            { month: "2026-07", return_pct: (103100 / 98100 - 1) * 100 },
            { month: "2026-08", return_pct: (103950 / 103100 - 1) * 100 },
          ]
        : [],
      attribution: fixture
        ? [
            {
              group: "Lifecycle outcome",
              label: "Resolved episodes, after costs",
              pnl: 5870,
              episodes: 5,
            },
            {
              group: "Lifecycle outcome",
              label: "Open-chain option realization, after costs",
              pnl: 580,
              episodes: 1,
            },
            {
              group: "Lifecycle outcome",
              label: "Open assigned-stock MTM",
              pnl: -2500,
              episodes: 1,
            },
          ]
        : [],
    },
    positions,
    chains: fixture
      ? [
          {
            ...evidence,
            id: "demo-aapl-001",
            symbol: "AAPL",
            state: "RECOVERY_WAIT",
            whole_chain_pnl: -1920,
            capital_committed: 18000,
            capital_days: 432000,
            events,
          },
        ]
      : [],
    history: events.map((event, i) => ({
      ...evidence,
      id: `demo-trade-${i}`,
      time: event.timestamp,
      symbol: "AAPL",
      action: event.action,
      contract: event.contract,
      qty: i === 1 ? 100 : i === 0 ? 1 : 0,
      expected: null,
      fill: event.option_price,
      slippage: null,
      pnl_effect: event.realized_pnl,
      chain_id: "demo-aapl-001",
      status: "DEMO",
      reasons: [event.reason],
      aegis: "Demo: HOLD_ONLY",
      snapshot_ref: `demo-snapshot-${i}`,
      management_state: i < 1 ? "CSP_OPEN" : "RECOVERY_WAIT",
    })),
    risk_view: {
      ...evidence,
      level: "UNRATED",
      metrics: [
        metric(
          "Capital in use",
          "Committed capital",
          "USD",
          "Includes capital held by assigned inventory.",
          fixture ? 18000 : null,
        ),
        metric(
          "Current drawdown",
          "Peak-to-current drawdown",
          "PERCENT",
          "Decline from the latest economic equity high.",
          fixture ? (equity.at(-1)?.drawdown ?? null) : null,
        ),
        metric(
          "Worst historical drawdown",
          "Maximum Drawdown",
          "PERCENT",
          "Historical losses can be exceeded.",
          fixture ? Math.min(...equity.map((p) => p.drawdown)) : null,
        ),
      ],
      exposures: fixture ? [{ symbol: "AAPL", capital: 18000 }] : [],
      greeks: { delta: null, gamma: null, vega: null, theta: null },
      stress: [
        "Market -3%",
        "Market -5%",
        "Market -10%",
        "Volatility +25%",
        "Volatility +50%",
      ].map((scenario) => ({ scenario, loss: null })),
    },
    intelligence: {
      ...evidence,
      sections: [
        {
          title: "Current environment",
          evidence: "OBSERVED",
          summary:
            "PAPER is the configured broker environment. Current regime, market session and runtime freshness are unavailable.",
        },
        {
          title: "What has worked",
          evidence: "RESEARCH",
          summary:
            "No validated regime, DTE or ownership cohort has been published. Results require independent out-of-sample evidence.",
        },
        {
          title: "What has hurt",
          evidence: "RESEARCH",
          summary:
            "Assignment, concentration and long recovery are research risks. No measured worst cohort is available.",
        },
        {
          title: "Management",
          evidence: "RESEARCH",
          summary:
            "Close, hold, roll and assignment are compared from the same state. Prior roll losses remain in the ledger.",
        },
        {
          title: "Recovery",
          evidence: fixture ? "OBSERVED" : "RESEARCH",
          summary: fixture
            ? "DEMO DATA: one assigned-stock chain is in RECOVERY_WAIT with a $2,500 stock loss. It remains unresolved."
            : "Recovery duration and unresolved inventory are unknown until reconciled position evidence is published.",
        },
      ],
      model: {
        calibration: "UNKNOWN",
        drift: "UNKNOWN",
        independent_n: null,
        explanation:
          "THETA-Q is a transparent research baseline. Calibrated entry expectancy and production model health are unavailable.",
      },
    },
    activity: events.map((event, i) => ({
      ...evidence,
      id: `demo-activity-${i}`,
      time: event.timestamp,
      message:
        [
          "THETA opened an AAPL cash-secured put.",
          "THETA accepted assignment into 100 AAPL shares.",
          "THETA is waiting for recovery.",
        ][i] ?? "",
      kind: event.action,
      detail: event.reason,
      chain_id: "demo-aapl-001",
    })),
  };
}
