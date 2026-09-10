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
  runtime: "RUNNING" | "PAUSED" | "SAFE_HOLD" | "KILLED" | "NOT_STARTED" | "RESEARCH";
  automation: "NOT_ENABLED" | "RESEARCH" | "PAUSED";
  broker: "CONNECTED" | "DEGRADED" | "UNAVAILABLE" | "NOT_PUBLISHED" | "NOT_APPLICABLE";
  broker_environment: "PAPER" | "NOT_APPLICABLE";
  aegis: "UNKNOWN" | "ALLOW_FULL" | "ALLOW_REDUCED" | "HOLD_ONLY" | "HARD_VETO";
  last_decision: string | null;
  last_fill: string | null;
  next_evaluation: string | null;
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
  contract: string | null;
  expiration: string | null;
  strike: number | null;
  entry_credit: number | null;
  current_close_debit: number | null;
  captured_premium: number | null;
  stock_basis: number | null;
  economic_basis: number | null;
  open_mtm: number | null;
  capital_committed: number;
  next_evaluation: string | null;
  current_action: string;
  reason: string;
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
  decision_id: string | null;
  order_id: string | null;
  fill_id: string | null;
  order_status: "NOT_APPLICABLE" | "PENDING" | "PARTIAL_FILL" | "FILLED" | "REJECTED";
  aegis: BotStatus["aegis"];
  economic_result: number | null;
}

export type PaperCopyStage =
  | "CONNECT_ALPACA"
  | "CHOOSE_ALLOCATION"
  | "REVIEW"
  | "WAITING_FOR_COPY_RUNTIME"
  | "ACTIVE";

export type FollowerParticipation =
  | "NOT_CONNECTED"
  | "READY_TO_COPY"
  | "COPY_NEW_AND_MANAGE"
  | "STOP_NEW_TRADES_MANAGE_EXISTING"
  | "DISCONNECTED"
  | "BLOCKED"
  | "RECONCILING";

export interface FollowerAccount {
  follower_account_id: string | null;
  provider: "ALPACA";
  environment: "PAPER";
  connection_method: "OAUTH";
  masked_account: string | null;
  state: "NOT_CONNECTED" | "AUTHORIZING" | "VERIFYING" | "READY" | "DEGRADED" | "REVOKED";
  verified_at: string | null;
  buying_power: number | null;
  cash: number | null;
  options_enabled: boolean | null;
  last_sync_at: string | null;
}

export interface FollowerRiskPolicy {
  allocation_usd: number;
  max_bot_capital_pct: number;
  max_ticker_exposure_pct: number;
  max_contracts: number;
  max_daily_loss_usd: number;
  max_open_positions: number;
  min_dte: number;
  max_dte: number;
  allow_0dte: boolean;
  max_slippage_per_contract_usd: number;
  min_open_interest: number;
  join_existing_positions: false;
  start_new_trades_only: true;
}

export interface PaperCopyReadiness {
  extension_version: "THETA_v1.2_PAPER_COPY";
  stage: PaperCopyStage;
  follower_account: FollowerAccount;
  oauth: {
    architecture: "ALPACA_OAUTH_SERVER_SIDE";
    configured: boolean;
    state: "NOT_CONFIGURED" | "CUSTOMER_LOGIN_REQUIRED" | "READY";
    token_storage: "ENCRYPTED_SERVER_SIDE" | "NOT_CONFIGURED";
  };
  participation: FollowerParticipation;
  copy_runtime: "ORDER_INTENT_READY_EXECUTION_LOCKED" | "PERSISTENCE_NOT_CONFIGURED";
  activation_allowed: boolean;
  master_fill_first: true;
  raw_master_quantity_copy: false;
  reason: string;
  customer_authority: {
    bot_controls_strategy: true;
    per_trade_approval: false;
    customer_controls: readonly [
      "CONNECT_ACCOUNT",
      "SET_ALLOCATION",
      "STOP_NEW_TRADES",
      "DISCONNECT_ACCOUNT",
    ];
    existing_position_management_after_stop: true;
    automatic_liquidation_on_disconnect: false;
  };
}

export interface FollowerResults extends Evidence {
  participation: FollowerParticipation;
  allocation_usd: number | null;
  metrics: Metric[];
  positions: BotPosition[];
  history: BotTrade[];
  tracking: {
    master_events_seen: number | null;
    copied_full: number | null;
    copied_reduced: number | null;
    skipped: number | null;
    diverged: number | null;
    last_sync_at: string | null;
  };
  reason: string;
}

export interface CopyPolicyReview {
  extension_version: "THETA_v1.2_PAPER_COPY";
  stage: "REVIEW" | "READY_TO_COPY";
  policy: FollowerRiskPolicy;
  final_quantity: 0;
  activation_allowed: boolean;
  sizing_basis: "FOLLOWER_SPECIFIC_PREFLIGHT_REQUIRED";
  reason: "ACCOUNT_CONNECTION_REQUIRED" | "READY_TO_SAVE_PARTICIPATION";
}

export interface MasterPaperConnection {
  provider: "ALPACA";
  environment: "PAPER";
  credential_storage: "SERVER_ENVIRONMENT_REFERENCE";
  configured: boolean;
  connection_state: "CONFIGURED_NOT_VERIFIED" | "NOT_CONFIGURED" | "GOOD" | "DEGRADED" | "INVALID";
  masked_account: string | null;
  checked_at: string | null;
  capabilities: Record<string, string>;
  account_status: string | null;
  equity: number | null;
  cash: number | null;
  buying_power: number | null;
  options_buying_power: number | null;
  options_level: number | null;
  open_positions: number | null;
  open_orders: number | null;
  market_open: boolean | null;
  market_data_feed: string;
  execution_enabled: false;
  reconnect_method: "SECURE_ENVIRONMENT_ROTATION";
  disconnect_available_in_ui: false;
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
