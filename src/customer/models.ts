import { z } from "zod";

export const environmentSchema = z.enum([
  "RESEARCH",
  "SHADOW",
  "PAPER",
  "LIVE_SMALL",
  "LIVE",
]);
export const provenanceSchema = z.enum([
  "RESEARCH",
  "LIVE_BROKER_DATA",
  "LIVE_SMALL",
  "PAPER",
  "SHADOW",
  "UNTOUCHED_OOS",
  "BACKTEST",
  "HISTORICAL_SIMULATION",
  "DEMO_DATA",
]);
export const qualitySchema = z.enum([
  "GOOD",
  "DEGRADED",
  "STALE",
  "UNKNOWN",
  "INVALID",
]);
export interface Evidence {
  bot_id: string;
  strategy_version: string | null;
  environment: z.infer<typeof environmentSchema>;
  as_of: string | null;
  data_quality: z.infer<typeof qualitySchema>;
  provenance: z.infer<typeof provenanceSchema>;
}
export interface Metric {
  label: string;
  technical_name: string;
  value: number | null;
  unit: "USD" | "PERCENT" | "RATIO" | "COUNT" | "DAYS" | "USD_DAYS";
  explanation: string;
  reason: string | null;
}
export interface BotStatus {
  mode: Evidence["environment"];
  automation: "NOT_ENABLED" | "RESEARCH";
  aegis: "UNKNOWN";
  last_decision: string | null;
  last_fill: string | null;
  current_exposure: number | null;
  market_session: "UNKNOWN";
  regime: "UNKNOWN";
  activation_allowed: false;
  copy_available: false;
  simulation_available: boolean;
}
export interface BotSummary extends Evidence {
  name: string;
  category: string;
  strategy: string;
  description: string;
  risk: "UNRATED";
  risk_explanation: string;
  capital_minimum: number | null;
  holding: "Lifecycle" | "Days" | "Weeks" | "Intraday";
  instruments: string[];
  available: boolean;
  status: BotStatus;
  metrics: Metric[];
}
export interface PerformanceProvenance extends Evidence {
  source: string;
  start_date: string | null;
  live_duration_days: number | null;
  paper_duration_days: number | null;
  resolved_episodes: number | null;
  independent_n: number | null;
  open_positions_included: boolean | null;
  fees_included: boolean | null;
  slippage_included: boolean | null;
  stock_mtm_included: boolean | null;
  assignment_included: boolean | null;
  limitation: string;
}
export interface BotEquityPoint {
  date: string;
  total: number;
  realized: number;
  unrealized: number;
  benchmark: number | null;
  capital_utilized: number;
  drawdown: number;
}
export interface BotDrawdownPoint {
  date: string;
  drawdown: number;
}
export interface BotPerformance extends Evidence {
  metrics: Metric[];
  advanced: Metric[];
  track_record: PerformanceProvenance;
  monthly: { month: string; return_pct: number }[];
  attribution: {
    group: string;
    label: string;
    pnl: number;
    episodes: number;
  }[];
  equity: BotEquityPoint[];
}
export interface BotLifecycleEvent {
  timestamp: string;
  action: string;
  contract: string | null;
  underlying: string;
  option_price: number | null;
  cashflow: number;
  realized_pnl: number;
  unrealized_pnl: number | null;
  reason: string;
  strategy_version: string;
}
export interface BotLifecycleChain extends Evidence {
  id: string;
  symbol: string;
  state: string;
  whole_chain_pnl: number;
  capital_committed: number;
  capital_days: number;
  events: BotLifecycleEvent[];
}
export interface BotPosition extends Evidence {
  chain_id: string;
  symbol: string;
  lifecycle_state: string;
  position: string;
  cost_basis: number;
  current_price: number;
  collateral: number;
  premium_collected: number;
  stock_mtm: number;
  whole_chain_pnl: number;
  dte: number | null;
  aegis: string;
  next_action: string;
}
export interface BotTrade extends Evidence {
  id: string;
  time: string;
  symbol: string;
  action: string;
  contract: string | null;
  qty: number;
  expected: number | null;
  fill: number | null;
  slippage: number | null;
  pnl_effect: number;
  chain_id: string;
  status: string;
  reasons: string[];
  aegis: string;
  snapshot_ref: string;
  management_state: string;
}
export interface BotModelHealth {
  calibration: "UNKNOWN";
  drift: "UNKNOWN";
  independent_n: null;
  explanation: string;
}
export interface BotIntelligence extends Evidence {
  sections: {
    title: string;
    evidence: "OBSERVED" | "MODEL_ESTIMATE" | "RESEARCH";
    summary: string;
  }[];
  model: BotModelHealth;
}
export interface BotRisk extends Evidence {
  level: "UNRATED";
  metrics: Metric[];
  exposures: { symbol: string; capital: number }[];
  greeks: { delta: null; gamma: null; vega: null; theta: null };
  stress: { scenario: string; loss: number | null }[];
}
export interface BotActivity extends Evidence {
  id: string;
  time: string;
  message: string;
  kind: string;
  detail: string;
  chain_id: string | null;
}
export interface BotDetail extends BotSummary {
  tags: string[];
  performance: BotPerformance;
  positions: BotPosition[];
  history: BotTrade[];
  chains: BotLifecycleChain[];
  risk_view: BotRisk;
  intelligence: BotIntelligence;
  activity: BotActivity[];
}
export interface BotComparison {
  api_version: "v1";
  bots: BotSummary[];
  allocation_recommendation: null;
}
export interface ApiEnvelope<T> {
  api_version: "v1";
  dataset: "published" | "demo";
  data: T;
}
