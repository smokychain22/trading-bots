import { z } from "zod";
import type { Environment } from "../config/environment.js";
import { assertProviderConfiguration, loadEnvironment } from "../config/environment.js";
import { checkAlpaca, type CheckResult } from "../providers/readiness.js";
import type {
  CopyPolicyReview,
  FollowerResults,
  MasterPaperConnection,
  PaperCopyReadiness,
} from "./models.js";
import type { FollowerRecord } from "./customer-store.js";
import { oauthConfiguration } from "./alpaca-oauth.js";

export const paperCopyPolicySchema = z
  .object({
    allocation_usd: z.number().finite().min(0).max(10_000_000),
    max_bot_capital_pct: z.number().finite().min(0).max(100),
    max_ticker_exposure_pct: z.number().finite().min(0).max(100),
    max_contracts: z.number().int().min(0).max(1_000),
    max_daily_loss_usd: z.number().finite().min(0).max(10_000_000),
    max_open_positions: z.number().int().min(0).max(1_000),
    min_dte: z.number().int().min(0).max(730),
    max_dte: z.number().int().min(0).max(730),
    allow_0dte: z.boolean(),
    max_slippage_per_contract_usd: z.number().finite().min(0).max(100_000),
    min_open_interest: z.number().int().min(0).max(100_000_000),
    join_existing_positions: z.literal(false),
    start_new_trades_only: z.literal(true),
  })
  .strict()
  .refine((policy) => policy.min_dte <= policy.max_dte, {
    message: "Minimum DTE must not exceed maximum DTE.",
  })
  .refine((policy) => policy.allow_0dte || policy.min_dte > 0, {
    message: "Minimum DTE must be at least one when 0DTE is disabled.",
  });

export function paperCopyReadiness(
  source: NodeJS.ProcessEnv = process.env,
  follower: FollowerRecord | null = null,
  authenticated = false,
): PaperCopyReadiness {
  const environment = loadEnvironment(source);
  const oauth = oauthConfiguration(environment);
  const connected = follower !== null;
  const participation = !follower
    ? "NOT_CONNECTED"
    : follower.participation === "ACTIVE"
      ? "COPY_NEW_AND_MANAGE"
      : follower.participation === "STOP_NEW_ENTRIES"
        ? "STOP_NEW_TRADES_MANAGE_EXISTING"
        : follower.participation === "BLOCKED"
          ? "BLOCKED"
          : "READY_TO_COPY";
  return {
    extension_version: "THETA_v1.2_PAPER_COPY",
    stage: connected ? "CHOOSE_ALLOCATION" : "CONNECT_ALPACA",
    follower_account: {
      follower_account_id: follower?.followerAccountId ?? null,
      provider: "ALPACA",
      environment: "PAPER",
      connection_method: "OAUTH",
      masked_account: follower?.maskedAccount ?? null,
      state: !follower ? "NOT_CONNECTED" : follower.accountReady ? "READY" : "DEGRADED",
      verified_at: follower?.lastBrokerSyncAt ?? null,
      buying_power: follower?.buyingPower ?? null,
      cash: follower?.cash ?? null,
      options_enabled: follower ? (follower.optionsTradingLevel ?? follower.optionsApprovedLevel ?? 0) >= 2 : null,
      last_sync_at: follower?.lastBrokerSyncAt ?? null,
    },
    oauth: {
      architecture: "ALPACA_OAUTH_SERVER_SIDE",
      configured: oauth.configured,
      state: !oauth.configured
        ? "NOT_CONFIGURED"
        : authenticated
          ? "READY"
          : "CUSTOMER_LOGIN_REQUIRED",
      token_storage: oauth.configured ? "ENCRYPTED_SERVER_SIDE" : "NOT_CONFIGURED",
    },
    participation,
    copy_runtime: source.DATABASE_URL
      ? "ORDER_INTENT_READY_EXECUTION_LOCKED"
      : "PERSISTENCE_NOT_CONFIGURED",
    activation_allowed: Boolean(follower?.accountReady && oauth.configured),
    master_fill_first: true,
    raw_master_quantity_copy: false,
    reason: !oauth.configured
      ? "Alpaca connection is not available yet."
      : !authenticated
        ? "Sign in to connect your Alpaca Paper account."
        : !connected
          ? "Connect your Alpaca Paper account."
          : follower.accountReady
            ? "Your account is ready to save a paper-copy allocation. Order submission remains locked."
            : "Your Alpaca Paper account does not currently meet THETA readiness requirements.",
    customer_authority: {
      bot_controls_strategy: true,
      per_trade_approval: false,
      customer_controls: [
        "CONNECT_ACCOUNT",
        "SET_ALLOCATION",
        "STOP_NEW_TRADES",
        "DISCONNECT_ACCOUNT",
      ],
      existing_position_management_after_stop: true,
      automatic_liquidation_on_disconnect: false,
    },
  };
}

export function followerResults(): FollowerResults {
  return {
    bot_id: "theta",
    strategy_version: null,
    environment: "PAPER",
    as_of: null,
    data_quality: "UNKNOWN",
    provenance: "PAPER",
    participation: "NOT_CONNECTED",
    allocation_usd: null,
    metrics: [
      {
        label: "Your economic P&L",
        technical_name: "Follower Whole-Chain P&L",
        value: null,
        unit: "USD",
        explanation: "Your option, stock, dividend, fee, and slippage economics.",
        reason: "No follower paper account is connected.",
      },
      {
        label: "Your return",
        technical_name: "Follower Economic Return",
        value: null,
        unit: "PERCENT",
        explanation: "Economic return on your allocated paper capital.",
        reason: "No follower paper account is connected.",
      },
      {
        label: "Open positions",
        technical_name: "Follower Open Positions",
        value: null,
        unit: "COUNT",
        explanation: "Broker-reconciled positions in your account.",
        reason: "No follower paper account is connected.",
      },
    ],
    positions: [],
    history: [],
    tracking: {
      master_events_seen: null,
      copied_full: null,
      copied_reduced: null,
      skipped: null,
      diverged: null,
      last_sync_at: null,
    },
    reason:
      "Connect an Alpaca Paper account and start copying before personal results can be measured.",
  };
}

export function reviewPaperCopyPolicy(raw: unknown, accountReady = false): CopyPolicyReview {
  return {
    extension_version: "THETA_v1.2_PAPER_COPY",
    stage: accountReady ? "READY_TO_COPY" : "REVIEW",
    policy: paperCopyPolicySchema.parse(raw),
    final_quantity: 0,
    activation_allowed: accountReady,
    sizing_basis: "FOLLOWER_SPECIFIC_PREFLIGHT_REQUIRED",
    reason: accountReady ? "READY_TO_SAVE_PARTICIPATION" : "ACCOUNT_CONNECTION_REQUIRED",
  };
}

export function masterConnectionMetadata(
  source: NodeJS.ProcessEnv = process.env,
): MasterPaperConnection {
  const configured = Boolean(
    source.ALPACA_API_KEY &&
      source.ALPACA_SECRET_KEY &&
      source.ALPACA_BASE_URL === "https://paper-api.alpaca.markets",
  );
  return {
    provider: "ALPACA",
    environment: "PAPER",
    credential_storage: "SERVER_ENVIRONMENT_REFERENCE",
    configured,
    connection_state: configured ? "CONFIGURED_NOT_VERIFIED" : "NOT_CONFIGURED",
    masked_account: null,
    checked_at: null,
    capabilities: {},
    account_status: null,
    equity: null,
    cash: null,
    buying_power: null,
    options_buying_power: null,
    options_level: null,
    open_positions: null,
    open_orders: null,
    market_open: null,
    market_data_feed: "UNKNOWN",
    execution_enabled: false,
    reconnect_method: "SECURE_ENVIRONMENT_ROTATION",
    disconnect_available_in_ui: false,
  };
}

export function summarizeMasterReadiness(
  results: readonly CheckResult[],
): MasterPaperConnection {
  const account = results.find((result) => result.capability === "ACCOUNT_ENVIRONMENT");
  const capabilities = Object.fromEntries(
    results.map((result) => [result.capability, result.state]),
  );
  const positions = results.find((result) => result.capability === "POSITIONS_READ");
  const orders = results.find((result) => result.capability === "OPEN_ORDERS_READ");
  const clock = results.find((result) => result.capability === "MARKET_CLOCK");
  const optionData = results.find((result) => result.capability === "OPTIONS_MARKET_DATA_OPRA");
  const numberDetail = (name: string): number | null =>
    typeof account?.details[name] === "number" ? account.details[name] : null;
  const states = results.map((result) => result.state);
  const connectionState = states.every((state) => state === "GOOD")
    ? "GOOD"
    : states.some((state) => state === "INVALID")
      ? "INVALID"
      : "DEGRADED";
  return {
    ...masterConnectionMetadata({
      ALPACA_API_KEY: "configured",
      ALPACA_SECRET_KEY: "configured",
      ALPACA_BASE_URL: "https://paper-api.alpaca.markets",
    }),
    connection_state: connectionState,
    masked_account:
      typeof account?.details.maskedAccount === "string"
        ? account.details.maskedAccount
        : null,
    checked_at:
      results.reduce<string | null>(
        (latest, result) =>
          latest === null || result.observedAt > latest ? result.observedAt : latest,
        null,
      ),
    capabilities,
    account_status: typeof account?.details.accountStatus === "string" ? account.details.accountStatus : null,
    equity: numberDetail("equity"),
    cash: numberDetail("cash"),
    buying_power: numberDetail("buyingPower"),
    options_buying_power: numberDetail("optionsBuyingPower"),
    options_level: numberDetail("optionsLevel"),
    open_positions: typeof positions?.details.positionCount === "number" ? positions.details.positionCount : null,
    open_orders: typeof orders?.details.openOrderCount === "number" ? orders.details.openOrderCount : null,
    market_open: typeof clock?.details.isOpen === "boolean" ? clock.details.isOpen : null,
    market_data_feed: optionData?.state === "GOOD" ? "OPRA" : "INDICATIVE_OR_NOT_ENTITLED",
  };
}

export async function verifyMasterPaperConnection(
  environment: Environment,
): Promise<MasterPaperConnection> {
  assertProviderConfiguration(environment, "ALPACA");
  return summarizeMasterReadiness(await checkAlpaca(environment));
}
