import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { botDetail, botSummaries } from "./catalog.js";
import { matchesOperatorToken } from "../providers/readiness-handler.js";
import { loadEnvironment } from "../config/environment.js";
import {
  masterConnectionMetadata,
  followerResults,
  paperCopyReadiness,
  reviewPaperCopyPolicy,
  verifyMasterPaperConnection,
} from "./paper-copy.js";
import { customerStore } from "./customer-store.js";
import {
  currentCustomer,
  loginCustomer,
  logoutCustomer,
  registerCustomer,
  safeCustomerReturnPath,
} from "./customer-auth.js";
import {
  completeAlpacaOAuth,
  oauthConfiguration,
  reverifyStoredFollowerAccount,
  startAlpacaOAuth,
} from "./alpaca-oauth.js";
import { checkDatabaseReadiness } from "./database-readiness.js";
import {
  privatePaperBetaReadiness,
  verifyOptionomicsConnection,
} from "./operator-readiness.js";
import { executionMode } from "../execution/execution-control.js";
import { connectPrivatePaperApiKey, privatePaperApiKeyConfiguration } from "./private-paper-api-key.js";
import { AlpacaPaperBrokerError } from "../execution/broker.js";
import { designateConnectedPaperMaster, masterRoleStore } from "./paper-account-role.js";
import { paperCopyPolicySchema, recommendedCopyPolicy } from "./copy-policy.js";

const simulationSchema = z
  .object({
    capital: z.number().finite().min(0).max(10000000),
    strike: z.number().finite().positive().max(100000),
    premium: z.number().finite().nonnegative(),
    stock_at_exit: z.number().finite().nonnegative(),
    max_contracts: z.number().int().min(0).max(1000),
    costs_per_contract: z.number().finite().nonnegative(),
    dte: z.number().int().min(1).max(730),
    min_dte: z.number().int().min(1),
    max_dte: z.number().int().min(1).max(730),
    max_daily_loss: z.number().finite().nonnegative(),
    max_slippage: z.number().finite().nonnegative(),
    min_open_interest: z.number().int().nonnegative(),
    join_existing: z.literal(false),
  })
  .strict()
  .refine(
    (v) => v.min_dte <= v.max_dte && v.premium < v.strike,
    "Invalid range or premium",
  );

export function simulateCapital(raw: unknown) {
  const input = simulationSchema.parse(raw);
  const cost = input.strike * 100 + input.costs_per_contract;
  const allowedDte = input.dte >= input.min_dte && input.dte <= input.max_dte;
  const quantity = allowedDte
    ? Math.min(input.max_contracts, Math.floor(input.capital / cost))
    : 0;
  const assignment = quantity > 0 && input.stock_at_exit < input.strike;
  const premium = quantity * input.premium * 100;
  const fees = quantity * input.costs_per_contract;
  const stockMtm = assignment
    ? (input.stock_at_exit - input.strike) * quantity * 100
    : 0;
  return {
    provenance: "DEMO_DATA",
    type: "ILLUSTRATIVE_CAPITAL_SCENARIO",
    quantity,
    collateral: quantity * input.strike * 100,
    premium,
    costs: fees,
    stock_mtm: stockMtm,
    economic_pnl: premium + stockMtm - fees,
    assignment_assumed: assignment,
    execution_authorized: false,
    reason: !allowedDte
      ? "DTE_OUTSIDE_USER_RANGE"
      : quantity === 0
        ? "CAPITAL_OR_QUANTITY_LIMIT"
        : "ILLUSTRATIVE_ONLY",
    controls_saved: input,
    limitations: [
      "User-entered hypothetical inputs, not forecast or backtest.",
      "Assignment below strike is a simplified scenario assumption.",
      "Daily loss, liquidity and slippage preferences are recorded only. There is no execution runtime enforcing them.",
      "No account is connected. Existing positions are never joined.",
    ],
  };
}
function send(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}
function redirect(response: ServerResponse, location: string) {
  response.statusCode = 302;
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Location", location);
  response.end();
}
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}
const authSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(12).max(200),
  return_to: z.string().max(200).optional(),
}).strict();
async function readJson(request: IncomingMessage) {
  // Vercel parses JSON before invoking a Node function. Express passes a stream.
  const parsed = (request as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) {
    if (JSON.stringify(parsed).length > 12000)
      throw new Error("body_too_large");
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 12000) throw new Error("body_too_large");
  }
  return JSON.parse(body);
}
function sign(value: string, key: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}
export function validSession(
  cookie: string,
  key: string,
  now = Date.now(),
): boolean {
  if (key.length < 32) return false;
  const token =
    cookie
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("tb_operator="))
      ?.slice(12) ?? "";
  const [expiry, nonce, signature] = token.split(".");
  if (
    !expiry ||
    !nonce ||
    !signature ||
    !/^\d+$/.test(expiry) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  if (Number(expiry) <= now || Number(expiry) > now + 900000) return false;
  const expected = sign(`${expiry}.${nonce}`, key);
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
export default async function customerHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url ?? "/", "https://local.invalid");
    const route =
      url.searchParams.get("route") ??
      url.pathname.replace(/^\/api\/v1\/?/, "");
    const parts = route.split("/").filter(Boolean);
    const dataset = url.searchParams.get("dataset") ?? "published";
    if (!["published", "demo"].includes(dataset))
      return send(response, 400, { error: { code: "INVALID_DATASET" } });
    const environment = loadEnvironment();
    if (parts[0] === "auth") {
      let store;
      try {
        store = customerStore(environment.DATABASE_URL);
      } catch {
        return send(response, 503, { error: { code: "CUSTOMER_LOGIN_NOT_AVAILABLE" } });
      }
      if (request.method === "GET" && parts[1] === "session") {
        const customer = await currentCustomer(request, store);
        return send(response, 200, {
          api_version: "v1",
          data: customer ? { authenticated: true, email: customer.email } : { authenticated: false, email: null },
        });
      }
      if (!sameOrigin(request))
        return send(response, 403, { error: { code: "ORIGIN_REJECTED" } });
      if (request.method === "DELETE" && parts[1] === "session") {
        await logoutCustomer(request, response, store);
        return send(response, 200, { authenticated: false });
      }
      if (request.method === "POST" && ["register", "login"].includes(parts[1] ?? "")) {
        const body = authSchema.parse(await readJson(request));
        try {
          const customer = parts[1] === "register"
            ? await registerCustomer(response, store, body.email, body.password)
            : await loginCustomer(response, store, body.email, body.password);
          if (!customer) return send(response, 401, { error: { code: "LOGIN_FAILED" } });
          return send(response, parts[1] === "register" ? 201 : 200, {
            api_version: "v1",
            data: {
              authenticated: true,
              email: customer.email,
              return_to: safeCustomerReturnPath(body.return_to),
            },
          });
        } catch (error) {
          if (error instanceof Error && error.message.includes("duplicate key"))
            return send(response, 409, { error: { code: "ACCOUNT_EXISTS" } });
          throw error;
        }
      }
      return send(response, 404, { error: { code: "NOT_FOUND" } });
    }
    if (route === "alpaca/oauth/start" && request.method === "GET") {
      let store;
      try {
        store = customerStore(environment.DATABASE_URL);
      } catch {
        return send(response, 503, { error: { code: "ALPACA_CONNECTION_NOT_AVAILABLE" } });
      }
      const customer = await currentCustomer(request, store);
      if (!customer) return redirect(response, "/account?signin=required");
      const authorization = await startAlpacaOAuth(store, environment, customer.customerId);
      return redirect(response, authorization.toString());
    }
    if (route === "alpaca/oauth/callback" && request.method === "GET") {
      let store;
      try {
        store = customerStore(environment.DATABASE_URL);
      } catch {
        return redirect(response, "/bots/theta/copy?connection=unavailable");
      }
      const customer = await currentCustomer(request, store);
      if (!customer) return redirect(response, "/account?signin=required");
      if (url.searchParams.has("error"))
        return redirect(response, "/bots/theta/copy?connection=denied");
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!state || !code)
        return redirect(response, "/bots/theta/copy?connection=invalid");
      try {
        const completed = await completeAlpacaOAuth(store, environment, customer.customerId, state, code);
        return redirect(response, `${completed.returnPath}?connection=${completed.follower.accountReady ? "connected" : "blocked"}`);
      } catch (error) {
        const codeValue = error instanceof Error && error.message.includes("STATE") ? "invalid" : "failed";
        return redirect(response, `/bots/theta/copy?connection=${codeValue}`);
      }
    }
    if (route === "alpaca/connection" && request.method === "POST") {
      if (!sameOrigin(request)) return send(response, 403, { error: { code: "ORIGIN_REJECTED" } });
      if (process.env.VERCEL_ENV === "production" && request.headers["x-forwarded-proto"] !== "https")
        return send(response, 400, { error: { code: "HTTPS_REQUIRED" } });
      let store;
      try {
        store = customerStore(environment.DATABASE_URL);
      } catch {
        return send(response, 503, { error: { code: "ALPACA_CONNECTION_NOT_AVAILABLE" } });
      }
      const customer = await currentCustomer(request, store);
      if (!customer) return send(response, 401, { error: { code: "LOGIN_REQUIRED" } });
      try {
        const follower = await connectPrivatePaperApiKey(
          store, environment, customer.customerId, await readJson(request),
        );
        return send(response, 201, {
          api_version: "v1",
          data: {
            connected: true,
            connection_method: follower.connectionMethod,
            ready_for_theta: follower.accountReady,
            masked_account: follower.maskedAccount,
            account_status: follower.accountStatus,
            equity: follower.equity,
            cash: follower.cash,
            buying_power: follower.buyingPower,
            options_buying_power: follower.optionsBuyingPower,
            options_approved_level: follower.optionsApprovedLevel,
            options_trading_level: follower.optionsTradingLevel,
            open_positions: follower.openPositionCount,
            open_orders: follower.openOrderCount,
            market_open: follower.marketIsOpen,
            last_verified_at: follower.lastBrokerSyncAt,
            orders_submitted: false,
          },
        });
      } catch (error) {
        if (error instanceof AlpacaPaperBrokerError) {
          const unavailable = ["AMBIGUOUS_NETWORK", "RATE_LIMITED", "BROKER_REJECTED"].includes(error.category);
          return send(response, error.category === "INVALID_AUTH" ? 401 : unavailable ? 503 : 422, {
            error: { code: error.category, http_status: error.httpStatus },
          });
        }
        if (error instanceof Error && error.message === "ALPACA_PAPER_ACCOUNT_NOT_READY")
          return send(response, 422, { error: { code: "ACCOUNT_NOT_READY" } });
        if (error instanceof Error && error.message === "PRIVATE_PAPER_API_KEY_BETA_NOT_CONFIGURED")
          return send(response, 503, { error: { code: error.message } });
        if (error instanceof z.ZodError)
          return send(response, 400, { error: { code: "INVALID_REQUEST" } });
        return send(response, 503, { error: { code: "CONNECTION_SERVICE_UNAVAILABLE" } });
      }
    }
    if (route === "alpaca/connection" && request.method === "DELETE") {
      if (!sameOrigin(request)) return send(response, 403, { error: { code: "ORIGIN_REJECTED" } });
      let store;
      try {
        store = customerStore(environment.DATABASE_URL);
      } catch {
        return send(response, 503, { error: { code: "ALPACA_CONNECTION_NOT_AVAILABLE" } });
      }
      const customer = await currentCustomer(request, store);
      if (!customer) return send(response, 401, { error: { code: "LOGIN_REQUIRED" } });
      await store.disconnectFollower(customer.customerId);
      return send(response, 200, { api_version: "v1", data: { connected: false, orders_submitted: false } });
    }
    if (route === "alpaca/connection/verify" && request.method === "POST") {
      if (!sameOrigin(request))
        return send(response, 403, { error: { code: "ORIGIN_REJECTED" } });
      let store;
      try {
        store = customerStore(environment.DATABASE_URL);
      } catch {
        return send(response, 503, { error: { code: "ALPACA_CONNECTION_NOT_AVAILABLE" } });
      }
      const customer = await currentCustomer(request, store);
      if (!customer)
        return send(response, 401, { error: { code: "LOGIN_REQUIRED" } });
      try {
        const follower = await reverifyStoredFollowerAccount(
          store,
          environment,
          customer.customerId,
        );
        return send(response, 200, {
          api_version: "v1",
          data: {
            connected: true,
            ready_for_theta: follower.accountReady,
            masked_account: follower.maskedAccount,
            account_status: follower.accountStatus,
            equity: follower.equity,
            cash: follower.cash,
            buying_power: follower.buyingPower,
            options_buying_power: follower.optionsBuyingPower,
            options_approved_level: follower.optionsApprovedLevel,
            options_trading_level: follower.optionsTradingLevel,
            last_verified_at: follower.lastBrokerSyncAt,
            open_positions: follower.openPositionCount,
            open_orders: follower.openOrderCount,
            market_open: follower.marketIsOpen,
            orders_submitted: false,
          },
        });
      } catch {
        return send(response, 409, {
          error: { code: "CONNECTION_NEEDS_ATTENTION" },
        });
      }
    }
    if (parts[0] === "operator") {
      const key = process.env.THETA_READINESS_TOKEN ?? "";
      if (request.method === "POST" || request.method === "DELETE") {
        const origin = request.headers.origin;
        if (!origin || new URL(origin).host !== request.headers.host)
          return send(response, 403, { error: { code: "ORIGIN_REJECTED" } });
      }
      if (parts[1] === "session" && request.method === "POST") {
        const payload = await readJson(request);
        if (
          key.length < 32 ||
          typeof payload?.token !== "string" ||
          !matchesOperatorToken(`Bearer ${payload.token}`, key)
        ) {
          return send(response, 401, { error: { code: "ACCESS_DENIED" } });
        }
        const value = `${Date.now() + 900000}.${randomBytes(16).toString("hex")}`;
        response.setHeader(
          "Set-Cookie",
          `tb_operator=${value}.${sign(value, key)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900`,
        );
        return send(response, 200, { authenticated: true, expires_in: 900 });
      }
      if (parts[1] === "session" && request.method === "DELETE") {
        response.setHeader(
          "Set-Cookie",
          "tb_operator=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
        );
        return send(response, 200, { authenticated: false });
      }
      if (!validSession(request.headers.cookie ?? "", key))
        return send(response, 401, { error: { code: "OWNER_LOGIN_REQUIRED" } });
      if (route === "operator/master-account" && request.method === "GET") {
        try {
          const connections = await masterRoleStore(environment.DATABASE_URL).listConnections();
          return send(response, 200, { api_version: "v1", data: { connections, order_submission: "LOCKED" } });
        } catch {
          return send(response, 503, { error: { code: "MASTER_ROLE_DATABASE_UNAVAILABLE" } });
        }
      }
      if (route === "operator/master-account" && request.method === "POST") {
        const payload = z.object({ customer_id: z.string().uuid() }).strict().parse(await readJson(request));
        try {
          const data = await designateConnectedPaperMaster(environment, payload.customer_id, masterRoleStore(environment.DATABASE_URL));
          return send(response, 200, { api_version: "v1", data });
        } catch {
          return send(response, 409, { error: { code: "MASTER_ROLE_NOT_VERIFIED_OR_PERSISTED" } });
        }
      }
      if (route === "operator/master-readiness" && request.method === "POST") {
        try {
          const data = await verifyMasterPaperConnection(environment);
          return send(response, data.connection_state === "CONNECTED" ? 200 : 207, {
            api_version: "v1",
            data,
          });
        } catch {
          return send(response, 503, {
            error: {
              code: "MASTER_PAPER_READINESS_UNAVAILABLE",
              message:
                "The PAPER connection could not be verified. No order was submitted.",
            },
          });
        }
      }
      if (route === "operator/optionomics-readiness" && request.method === "POST") {
        const data = await verifyOptionomicsConnection(environment);
        return send(response, data.state === "CONNECTED" ? 200 : 207, {
          api_version: "v1",
          data: { ...data, orders_submitted: false },
        });
      }
      if (route === "operator/database-readiness" && request.method === "POST") {
        const data = await checkDatabaseReadiness(environment.DATABASE_URL);
        return send(response, data.state === "CONNECTED" ? 200 : 207, {
          api_version: "v1",
          data,
        });
      }
      if (route === "operator/provider-readiness" && request.method === "POST") {
        try {
          const [master, optionomics] = await Promise.all([
            verifyMasterPaperConnection(environment),
            verifyOptionomicsConnection(environment),
          ]);
          return send(response, 200, {
            api_version: "v1",
            data: {
              master,
              optionomics,
              orders_submitted: false,
            },
          });
        } catch {
          return send(response, 503, { error: { code: "PROVIDER_READINESS_UNAVAILABLE" } });
        }
      }
      if (request.method !== "GET")
        return send(response, 405, { error: { code: "READ_ONLY_OPERATOR" } });
      if (route !== "operator/status")
        return send(response, 404, { error: { code: "NOT_FOUND" } });
      const oauth = oauthConfiguration(environment);
      const privateBeta = privatePaperApiKeyConfiguration(environment);
      const connectionConfigured = oauth.configured || privateBeta.configured;
      const database = await checkDatabaseReadiness(environment.DATABASE_URL);
      const executionControl = {
        masterEnabled: environment.MASTER_PAPER_EXECUTION_ENABLED,
        followerEnabled: environment.FOLLOWER_PAPER_EXECUTION_ENABLED,
        pauseNewOrders: environment.PAPER_PAUSE_NEW_ORDERS,
      };
      const masterExecutionMode = executionMode(executionControl, "MASTER_API_KEY");
      const followerExecutionMode = executionMode(executionControl, "FOLLOWER_OAUTH");
      return send(response, 200, {
        api_version: "v1",
        data: {
          website:
            process.env.VERCEL_ENV === "production"
              ? "PRODUCTION"
              : "DEVELOPMENT_OR_PREVIEW",
          trading: masterExecutionMode,
          bot_mode: "PAPER",
          copy: connectionConfigured ? "READY_TO_CONNECT" : "BLOCKED",
          deployment_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
          provider_runtime: "UNKNOWN",
          systems: {
            theta_runtime: "REAL_INPUT_READY_NOT_SCHEDULED",
            quant_models: "HEALTHY",
            python_bridge: "HEALTHY",
            strategy_router: "HEALTHY",
            management_assembly: "HEALTHY",
            decision_assembly: "HEALTHY",
            alpaca_master_paper: masterConnectionMetadata().connection_state,
            market_data: "UNKNOWN",
            option_data: "UNKNOWN",
            scheduler: "NOT_RUNNING",
            aegis: "PARTIAL_REAL_INPUTS",
            execution: "PAPER_ADAPTER_READY_EXECUTION_LOCKED",
            ledger: database.state === "CONNECTED" ? "READY" : "SCHEMA_READY_DATABASE_REQUIRED",
            reconciliation: database.state === "CONNECTED" ? "READY_NOT_RUNNING" : "CONTRACT_READY_DATABASE_REQUIRED",
            customer_iam: database.customer_iam ? "READY" : "BLOCKED",
            database: database.state,
            alpaca_oauth: oauth.configured ? "READY" : "BLOCKED",
            token_vault: database.token_vault && environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY ? "READY" : "BLOCKED",
            follower_adapter: "PAPER_ADAPTER_READY_EXECUTION_LOCKED",
            copy_engine: environment.DATABASE_URL ? "ORDER_INTENT_READY_EXECUTION_LOCKED" : "BLOCKED",
            followers: database.active_followers === null ? "UNKNOWN" : String(database.active_followers),
            system_errors: "UNKNOWN",
          },
          runtime_detail: {
            stage: "REAL_INPUT_READY_NOT_SCHEDULED",
            policy_version: null,
            model_versions: ["theta-q-v0", "quant contract baselines"],
            last_market_snapshot: null,
            last_scan: null,
            last_decision: null,
            next_scan: null,
            candidates_evaluated: null,
            candidates_passing: null,
            candidates_rejected: null,
            candidates_waiting: null,
            candidates_q_zero: null,
            open_positions: null,
            pending_orders: null,
            unknown_submissions: null,
            reconciliation: database.state === "CONNECTED" ? "READY_NOT_RUNNING" : "DATABASE_REQUIRED",
          },
          execution_control: {
            environment: "PAPER",
            live_host_allowed: false,
            master_paper_execution: masterExecutionMode,
            follower_paper_execution: followerExecutionMode,
            pause_new_orders: environment.PAPER_PAUSE_NEW_ORDERS,
            customer_can_enable: false,
            orders_submitted_by_release: 0,
          },
          master_connection: masterConnectionMetadata(),
          database,
          copy_platform: {
            oauth: oauth.configured ? "READY" : "NEEDS_APP_CREDENTIALS",
            customer_iam: database.customer_iam ? "READY" : "NOT_READY",
            token_vault: database.token_vault && environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY ? "READY" : "NOT_READY",
            follower_broker_adapter: "PAPER_ADAPTER_READY_EXECUTION_LOCKED",
            copy_execution: followerExecutionMode,
            missing_configuration: oauth.missing,
            private_paper_beta: privatePaperBetaReadiness(database.private_beta_followers),
          },
          published_performance: false,
          gates: [
            "Real event-state assembly and remaining AEGIS exposure families are incomplete",
            "Shadow decision receipts are not yet persisted by a production scheduler",
            "OPRA entitlement not established for future execution",
            ...(database.state === "CONNECTED" ? [] : ["Production PostgreSQL is required for durable order and reconciliation workers"]),
            "First PAPER order requires separate owner authorization after a genuine preview",
            "No validated customer performance publication",
            connectionConfigured
              ? "Private team Paper connection is available; public accounts still require Alpaca Connect approval"
              : "A configured broker credential path is required for team accounts",
          ],
          security:
            "Operator session expires in 15 minutes. Read-only release visibility. No trading mutations are exposed.",
          connection_change_policy:
            "Master credentials are managed through secure deployment configuration. Disconnect and reconnect require an audited secret-reference change and are not exposed in this UI.",
        },
      });
    }
    if (route === "copy/readiness" && request.method === "GET") {
      let authenticated = false;
      let follower = null;
      if (environment.DATABASE_URL) {
        const store = customerStore(environment.DATABASE_URL);
        const customer = await currentCustomer(request, store);
        authenticated = customer !== null;
        follower = customer ? await store.getFollower(customer.customerId) : null;
      }
      return send(response, 200, {
        api_version: "v1",
        product_extension: "THETA_v1.2_PAPER_COPY",
        data: paperCopyReadiness(process.env, follower, authenticated),
      });
    }
    if (route === "copy/results" && request.method === "GET")
      return send(response, 200, {
        api_version: "v1",
        dataset: "published",
        data: followerResults(),
      });
    if (route === "copy/policy/validate" && request.method === "POST") {
      let accountReady = false;
      if (environment.DATABASE_URL) {
        const store = customerStore(environment.DATABASE_URL);
        const customer = await currentCustomer(request, store);
        const follower = customer ? await store.getFollower(customer.customerId) : null;
        accountReady = follower?.accountReady === true;
      }
      return send(response, 200, {
        api_version: "v1",
        product_extension: "THETA_v1.2_PAPER_COPY",
        data: reviewPaperCopyPolicy(await readJson(request), accountReady),
      });
    }
    if (route === "copy/participation" && request.method === "POST") {
      if (!sameOrigin(request)) return send(response, 403, { error: { code: "ORIGIN_REJECTED" } });
      let store;
      try {
        store = customerStore(environment.DATABASE_URL);
      } catch {
        return send(response, 503, { error: { code: "COPY_PERSISTENCE_NOT_AVAILABLE" } });
      }
      const customer = await currentCustomer(request, store);
      if (!customer) return send(response, 401, { error: { code: "LOGIN_REQUIRED" } });
      const rawPolicy = await readJson(request);
      const allocationOnly = z.object({ allocation_usd: z.number().finite().min(0).max(10_000_000) }).strict().safeParse(rawPolicy);
      const payload = allocationOnly.success ? recommendedCopyPolicy(allocationOnly.data.allocation_usd) : paperCopyPolicySchema.parse(rawPolicy);
      const follower = await store.getFollower(customer.customerId);
      if (!follower?.accountReady)
        return send(response, 409, { error: { code: "FOLLOWER_ACCOUNT_NOT_READY" } });
      if (follower.accountRole === "MASTER_THETA_PAPER")
        return send(response, 409, { error: { code: "MASTER_SELF_COPY_FORBIDDEN" } });
      const saved = await store.saveParticipation(customer.customerId, payload.allocation_usd, payload);
      return send(response, 200, {
        api_version: "v1",
        data: { participation: saved.participation, allocation_usd: saved.allocationUsd, policy: saved.policy, order_submission: "LOCKED" },
      });
    }
    if (request.method === "POST" && route === "bots/theta/simulate")
      return send(response, 200, {
        api_version: "v1",
        dataset: "demo",
        data: simulateCapital(await readJson(request)),
      });
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return send(response, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
    }
    if (parts[0] !== "bots")
      return send(response, 404, { error: { code: "NOT_FOUND" } });
    if (parts.length === 1)
      return send(response, 200, {
        api_version: "v1",
        dataset: "published",
        data: botSummaries(),
      });
    const detail = botDetail(parts[1] ?? "", dataset === "demo");
    if (!detail)
      return send(response, 404, { error: { code: "BOT_NOT_FOUND" } });
    const views: Record<string, unknown> = {
      status: {
        ...detail.status,
        as_of: detail.as_of,
        data_quality: detail.data_quality,
        provenance: detail.provenance,
      },
      performance: detail.performance,
      equity: detail.performance.equity,
      positions: detail.positions,
      history: detail.history,
      risk: detail.risk_view,
      intelligence: detail.intelligence,
      activity: detail.activity,
      chains: detail.chains,
    };
    const section = parts[2];
    const data =
      section === "chains" && parts[3]
        ? detail.chains.find((c) => c.id === parts[3])
        : section
          ? views[section]
          : detail;
    if (data === undefined || parts.length > (section === "chains" ? 4 : 3))
      return send(response, 404, { error: { code: "RESOURCE_NOT_FOUND" } });
    return send(response, 200, {
      api_version: "v1",
      dataset:
        dataset === "demo" && detail.bot_id === "theta" ? "demo" : "published",
      evidence: {
        as_of: detail.as_of,
        provenance: detail.provenance,
        data_quality: detail.data_quality,
      },
      data,
    });
  } catch {
    return send(response, 400, {
      error: {
        code: "INVALID_REQUEST",
        message: "The request could not be validated.",
      },
    });
  }
}
