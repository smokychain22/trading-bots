import { z } from "zod";
import type { Environment } from "../config/environment.js";
import { loadEnvironment, missingProviderVariables } from "../config/environment.js";
import { checkAlpaca, type CheckResult } from "../providers/readiness.js";
import type {
  CopyPolicyReview,
  FollowerResults,
  MasterPaperConnection,
  PaperCopyReadiness,
} from "./models.js";
import type { FollowerRecord } from "./customer-store.js";
import { oauthConfiguration } from "./alpaca-oauth.js";
import { privatePaperApiKeyConfiguration } from "./private-paper-api-key.js";

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
  const privateBeta = privatePaperApiKeyConfiguration(environment);
  const connectionConfigured = oauth.configured || privateBeta.configured;
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
      connection_method: follower?.connectionMethod ?? null,
      connected,
      ready_for_theta: follower?.accountReady ?? false,
      masked_account: follower?.maskedAccount ?? null,
      account_status: follower?.accountStatus ?? null,
      state: !follower
        ? "NOT_CONNECTED"
        : follower.connectionStatus === "REVOKED"
          ? "REVOKED"
          : follower.connectionStatus === "NEEDS_ATTENTION"
            ? "DEGRADED"
            : follower.accountReady
              ? "READY"
              : "CONNECTED_NOT_READY",
      verified_at: follower?.lastBrokerSyncAt ?? null,
      buying_power: follower?.buyingPower ?? null,
      options_buying_power: follower?.optionsBuyingPower ?? null,
      equity: follower?.equity ?? null,
      cash: follower?.cash ?? null,
      options_enabled: follower ? (follower.optionsTradingLevel ?? follower.optionsApprovedLevel ?? 0) >= 1 : null,
      options_approved_level: follower?.optionsApprovedLevel ?? null,
      options_trading_level: follower?.optionsTradingLevel ?? null,
      last_sync_at: follower?.lastBrokerSyncAt ?? null,
      open_positions: follower?.openPositionCount ?? null,
      open_orders: follower?.openOrderCount ?? null,
      market_open: follower?.marketIsOpen ?? null,
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
    private_paper_api_key: {
      configured: privateBeta.configured,
      state: !privateBeta.configured
        ? "NOT_CONFIGURED"
        : authenticated ? "READY" : "CUSTOMER_LOGIN_REQUIRED",
      credential_storage: privateBeta.configured ? "ENCRYPTED_SERVER_SIDE" : "NOT_CONFIGURED",
      order_submission: "LOCKED",
    },
    participation,
    copy_runtime: source.DATABASE_URL
      ? "ORDER_INTENT_READY_EXECUTION_LOCKED"
      : "PERSISTENCE_NOT_CONFIGURED",
    activation_allowed: Boolean(follower?.accountReady && connectionConfigured && follower.accountRole !== "MASTER_THETA_PAPER"),
    master_fill_first: true,
    raw_master_quantity_copy: false,
    reason: follower?.accountRole === "MASTER_THETA_PAPER"
      ? "This account is the THETA Paper master. It cannot copy itself. Order submission remains locked."
      : !connectionConfigured
      ? "Private Paper connection is disabled in this environment."
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
    connection_state: configured ? "CONFIGURED_NOT_VERIFIED" : "MISSING",
    masked_account: null,
    checked_at: null,
    capabilities: {},
    capability_results: [],
    account_status: null,
    equity: null,
    cash: null,
    buying_power: null,
    options_buying_power: null,
    options_approved_level: null,
    options_trading_level: null,
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
  const indicativeData = results.find((result) => result.capability === "OPTIONS_MARKET_DATA_INDICATIVE");
  const numberDetail = (name: string): number | null =>
    typeof account?.details[name] === "number" ? account.details[name] : null;
  const states = results.map((result) => result.state);
  const requiredConnectionResults = results.filter((result) => [
    "ACCOUNT_ENVIRONMENT",
    "POSITIONS_READ",
    "OPEN_ORDERS_READ",
    "MARKET_CLOCK",
    "MARKET_CALENDAR",
  ].includes(result.capability));
  const connectionState = requiredConnectionResults.every((result) => result.state === "GOOD")
    ? "CONNECTED"
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
    capability_results: results.map((result) => ({
      capability: result.capability,
      operation_alias: result.operationAlias,
      state: result.state,
      http_status: result.httpStatus,
      observed_at: result.observedAt,
    })),
    account_status: typeof account?.details.accountStatus === "string" ? account.details.accountStatus : null,
    equity: numberDetail("equity"),
    cash: numberDetail("cash"),
    buying_power: numberDetail("buyingPower"),
    options_buying_power: numberDetail("optionsBuyingPower"),
    options_approved_level: numberDetail("optionsApprovedLevel"),
    options_trading_level: numberDetail("optionsTradingLevel"),
    options_level: numberDetail("optionsLevel"),
    open_positions: typeof positions?.details.positionCount === "number" ? positions.details.positionCount : null,
    open_orders: typeof orders?.details.openOrderCount === "number" ? orders.details.openOrderCount : null,
    market_open: typeof clock?.details.isOpen === "boolean" ? clock.details.isOpen : null,
    market_data_feed: optionData?.state === "GOOD"
      ? "OPRA"
      : indicativeData?.state === "GOOD"
        ? "INDICATIVE"
        : "UNAVAILABLE",
  };
}

export async function verifyMasterPaperConnection(
  environment: Environment,
): Promise<MasterPaperConnection> {
  if (missingProviderVariables(environment, "ALPACA").length > 0)
    return masterConnectionMetadata({});
  return summarizeMasterReadiness(await checkAlpaca(environment));
}
