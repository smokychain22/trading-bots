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
  readLocalWorkerReadiness,
  readMasterRuntimeEvidence,
  readLatestRuntimeBehavior,
  readOutcomeResearchVisibility,
  readP2FOperatorStatus,
  readP2GOperatorStatus,
  verifyOptionomicsConnection,
} from "./operator-readiness.js";
import { executionMode } from "../execution/execution-control.js";
import { connectPrivatePaperApiKey, privatePaperApiKeyConfiguration } from "./private-paper-api-key.js";
import { AlpacaPaperBrokerError } from "../execution/broker.js";
import { designateAuthenticatedPaperMaster, masterRoleStore } from "./paper-account-role.js";
import { paperCopyPolicySchema, recommendedCopyPolicy } from "./copy-policy.js";
import { verifyStoredMasterPaperConnection } from "./master-paper-runtime.js";
import { PostgresOperatorControlStore } from "./operator-control.js";
import { Pool } from "pg";
import { qualifyOptionomicsProvider,persistOptionomicsQualification } from "../providers/optionomics-qualification.js";
import { optionomicsConfigFromEnvironment } from "../theta/theta-shadow-once.js";
import { canonicalThetaStrategyRegistry } from "../theta/strategy-package.js";
import { buildR8Readiness } from "../theta/r8-readiness.js";
import { assessReconciliationReadiness, buildThetaFirstPaperReadiness, type FirstPaperChecks } from "../theta/first-paper-blocker-budget.js";

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
        try {
          const data = await designateAuthenticatedPaperMaster(environment, masterRoleStore(environment.DATABASE_URL));
          return send(response, 200, { api_version: "v1", data });
        } catch {
          return send(response, 409, { error: { code: "MASTER_ROLE_NOT_VERIFIED_OR_PERSISTED" } });
        }
      }
      if (route === "operator/master-readiness" && request.method === "POST") {
        try {
          const data = await verifyStoredMasterPaperConnection(environment, customerStore(environment.DATABASE_URL));
          return send(response, data.connectionState === "CONNECTED" ? 200 : 207, {
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
      if (route === "operator/optionomics-qualification" && request.method === "POST") {
        if(!sameOrigin(request))return send(response,403,{error:{code:"ORIGIN_REJECTED"}});
        if(!environment.DATABASE_URL)return send(response,503,{error:{code:"QUALIFICATION_DATABASE_UNAVAILABLE"}});
        const pool=new Pool({connectionString:environment.DATABASE_URL,max:1,connectionTimeoutMillis:5_000});
        try{const receipt=await qualifyOptionomicsProvider({mode:'REAL_AUTHENTICATED',at:new Date().toISOString(),symbol:'SPY',
          config:optionomicsConfigFromEnvironment(environment)});await persistOptionomicsQualification(pool,receipt);
          return send(response,receipt.secretState==='AUTH_VALID'?200:207,{api_version:'v1',data:{version:receipt.version,
            secret_state:receipt.secretState,families:receipt.families.map(({family,state,blockers})=>({family,state,blockers})),
            real_payload_count:receipt.realPayloadCount,stale_capability_count:receipt.staleCapabilityCount,
            receipt_hash:receipt.receiptHash,execution_authorized:false,orders_submitted:false}});
        }finally{await pool.end();}
      }
      if (route === "operator/controls" && request.method === "GET") {
        if(!environment.DATABASE_URL)return send(response,503,{error:{code:"OPERATOR_CONTROL_DATABASE_UNAVAILABLE"}});
        const store=new PostgresOperatorControlStore(environment.DATABASE_URL);
        try{return send(response,200,{api_version:"v1",data:await store.current(environment.PAPER_PAUSE_NEW_ORDERS)});}
        finally{await store.close();}
      }
      if (route === "operator/controls" && request.method === "POST") {
        if(!environment.DATABASE_URL)return send(response,503,{error:{code:"OPERATOR_CONTROL_DATABASE_UNAVAILABLE"}});
        if(!sameOrigin(request))return send(response,403,{error:{code:"ORIGIN_REJECTED"}});
        const idempotencyKey=request.headers["idempotency-key"];
        if(typeof idempotencyKey!=="string")return send(response,400,{error:{code:"IDEMPOTENCY_KEY_REQUIRED"}});
        const body=z.object({command:z.enum(["PAUSE_NEW_ENTRIES","RESUME_NEW_ENTRIES","EMERGENCY_EXECUTION_LOCK","CLEAR_EMERGENCY_LOCK"]),
          confirmed:z.literal(true),observed_state_version:z.number().int().nonnegative(),reason:z.string().max(500).nullable().default(null)}).strict().parse(await readJson(request));
        const store=new PostgresOperatorControlStore(environment.DATABASE_URL);
        try{const data=await store.apply({actorRef:request.headers.cookie??"operator",command:body.command,
          idempotencyKey,confirmed:body.confirmed,requestedAt:new Date().toISOString(),defaultPaused:environment.PAPER_PAUSE_NEW_ORDERS,
          observedStateVersion:body.observed_state_version,reason:body.reason});
          return send(response,200,{api_version:"v1",data:{...data,execution_authorized:false}});
        }catch(error){if(error instanceof Error&&error.message==='OPERATOR_STATE_VERSION_STALE')return send(response,409,{error:{code:error.message}});
          throw error;}finally{await store.close();}
      }
      if (request.method !== "GET")
        return send(response, 405, { error: { code: "READ_ONLY_OPERATOR" } });
      if (route !== "operator/status")
        return send(response, 404, { error: { code: "NOT_FOUND" } });
      const oauth = oauthConfiguration(environment);
      const privateBeta = privatePaperApiKeyConfiguration(environment);
      const connectionConfigured = oauth.configured || privateBeta.configured;
      const operatorControl=environment.DATABASE_URL ? await (async()=>{
        const store=new PostgresOperatorControlStore(environment.DATABASE_URL as string);
        return store.current(environment.PAPER_PAUSE_NEW_ORDERS).finally(()=>store.close());
      })() : {newEntriesPaused:environment.PAPER_PAUSE_NEW_ORDERS,emergencyExecutionLock:false,
        brokerSubmissionBlocked:true,reconciliationEnabled:true,managementEnabled:true,source:"DEFAULT",asOf:null,stateVersion:0};
      const [database,localWorker,runtimeEvidence,runtimeBehavior,outcomeResearch,p2fStatus,p2gStatus] = await Promise.all([
        checkDatabaseReadiness(environment.DATABASE_URL),readLocalWorkerReadiness(environment.DATABASE_URL),
        readMasterRuntimeEvidence(environment.DATABASE_URL),readLatestRuntimeBehavior(environment.DATABASE_URL),
        readOutcomeResearchVisibility(environment.DATABASE_URL),readP2FOperatorStatus(environment.DATABASE_URL),
        readP2GOperatorStatus(environment.DATABASE_URL),
      ]);
      const executionControl = {
        masterEnabled: environment.MASTER_PAPER_EXECUTION_ENABLED && !operatorControl.emergencyExecutionLock,
        followerEnabled: environment.FOLLOWER_PAPER_EXECUTION_ENABLED,
        pauseNewOrders: environment.PAPER_PAUSE_NEW_ORDERS || operatorControl.newEntriesPaused,
      };
      const masterExecutionMode = executionMode(executionControl, "MASTER_API_KEY");
      const followerExecutionMode = executionMode(executionControl, "FOLLOWER_OAUTH");
      const strategyRegistry=[...canonicalThetaStrategyRegistry.values()].map((strategy)=>({
        strategy_id:strategy.strategyId,strategy_version:strategy.strategyVersion,branch:strategy.branch,
        status:strategy.status,promotion_status:strategy.promotionStatus,execution_enabled:strategy.executionEnabled,
        configuration_hash:strategy.configurationHash,
      }));
      const unknown = (blocker:string, source:string, blockerClass:'EXTERNAL'|'IMPLEMENTATION'|'PROVIDER'|'POLICY'='IMPLEMENTATION') =>
        ({state:'UNKNOWN' as const,blocker,source,blockerClass});
      const pass = (source:string) => ({state:'PASS' as const,source});
      const fail = (blocker:string,source:string,blockerClass:'EXTERNAL'|'IMPLEMENTATION'|'PROVIDER'|'POLICY') =>
        ({state:'FAIL' as const,blocker,source,blockerClass});
      const workerCycleHealthy=localWorker.online&&[
        'MASTER_PAPER_ACTIVE','MASTER_PAPER_MARKET_CLOSED','MASTER_PAPER_QUOTE_BLOCKED',
      ].includes(localWorker.state);
      const firstPaperChecks:FirstPaperChecks={
        databaseWritable:database.default_transaction_read_only==='on'
          ? fail('DATABASE_DEFAULT_READ_ONLY_ON','database-readiness','EXTERNAL')
          : database.state==='DEGRADED'||database.state==='MISSING'
          ? fail('DATABASE_UNAVAILABLE','database-readiness','EXTERNAL')
          : unknown('DATABASE_WRITE_TRANSACTION_NOT_PROVEN','database-readiness','EXTERNAL'),
        brokerHealthy:workerCycleHealthy&&localWorker.alpaca_health==='GOOD'
          ? pass('runtime-worker-status') : unknown('BROKER_CURRENT_HEALTH_NOT_PROVEN','runtime-worker-status','PROVIDER'),
        providerHealthy:p2fStatus.optionomics.secret_state==='AUTH_VALID'&&localWorker.optionomics_health==='GOOD'
          ? pass('provider-qualification-and-worker')
          : unknown('PROVIDER_CURRENT_HEALTH_NOT_PROVEN','provider-qualification-and-worker','PROVIDER'),
        eventEvidenceReady:unknown('COMPLETE_ENTRY_EVENT_COVERAGE_NOT_PROVEN','event-evidence','PROVIDER'),
        quotePipelineReady:unknown('FINALIST_AND_PRE_SUBMIT_REFRESH_NOT_PROVEN','runtime-quote-pipeline'),
        aegisReady:unknown('CURRENT_AEGIS_INPUT_COMPLETENESS_NOT_PROVEN','runtime-aegis'),
        positiveSizingReachable:unknown('REAL_POSITIVE_SIZING_NOT_PROVEN','runtime-sizing'),
        canonicalDecisionReachable:unknown('CURRENT_DECISION_PATH_NOT_PROVEN','runtime-decision'),
        paperPlanReachable:unknown('REAL_CURRENT_PAPER_PLAN_NOT_PROVEN','runtime-paper-plan'),
        managementCandidateSourceReady:unknown('MANAGEMENT_CANDIDATE_SOURCE_RUNTIME_NOT_PROVEN','runtime-management'),
        reconciliationReady:assessReconciliationReadiness({workerCycleHealthy,
          lastReconciliation:localWorker.last_reconciliation,
          // Old snapshots without a classified impact summary stay blocked by
          // the raw count. New snapshots use the narrower current-impact count.
          entryBlockingFactCount:runtimeEvidence.entry_blocking_fact_count ?? runtimeEvidence.external_or_unknown_count,
          localOnlyIntentCount:runtimeEvidence.local_only_intent_count}),
        workerReleaseReady:workerCycleHealthy&&
          localWorker.build_sha===process.env.VERCEL_GIT_COMMIT_SHA
          ? pass('runtime-worker-status-and-deployment-sha')
          : unknown('CURRENT_WORKER_RELEASE_NOT_PROVEN','runtime-worker-status-and-deployment-sha','EXTERNAL'),
      };
      const firstPaperReadiness=buildThetaFirstPaperReadiness({observedAt:new Date().toISOString(),
        checks:firstPaperChecks,unknownAuditCoverage:'PARTIAL',avoidableUnknownCount:null,
        implementationBlockerCount:null,unresolvedSafetyCriticalCount:null,unresolvedPaperEntryCount:null});
      const firstPaperOperationalBlockers=firstPaperReadiness.blockers.map((blocker)=>blocker.code);
      const r8Readiness=buildR8Readiness({r7EngineeringComplete:true,brokerTruthReady:localWorker.alpaca_health==='GOOD',
        sessionStateReady:localWorker.market_session!=='UNKNOWN',
        positionLifecycleReady:database.state==='CONNECTED',strategyRouterReady:true,actionFrontierReady:true,
        operatorSafetyReady:database.state==='CONNECTED',optionomicsTransportReady:true,
        optionomicsRealAuthReady:p2fStatus.optionomics.secret_state==='AUTH_VALID',
        executionQuoteProviderReady:localWorker.execution_gate==='ACTIVE',
        operationalFirstPaperReady:firstPaperOperationalBlockers.length===0,empiricalPolicyReady:false,managementPolicyPromoted:false,
        labelPipelineReady:database.state==='CONNECTED',wholeChainAccountingReady:database.state==='CONNECTED',
        trainingReady:(outcomeResearch.resolved_labels??0)>0});
      return send(response, 200, {
        api_version: "v1",
        data: {
          website:
            process.env.VERCEL_ENV === "production"
              ? "PRODUCTION"
              : "DEVELOPMENT_OR_PREVIEW",
          trading: localWorker.online ? localWorker.execution_gate : masterExecutionMode,
          bot_mode: "PAPER",
          copy: connectionConfigured ? "READY_TO_CONNECT" : "BLOCKED",
          deployment_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
          provider_runtime: "UNKNOWN",
          systems: {
            theta_runtime: localWorker.online ? localWorker.state : "MASTER_PAPER_OFFLINE",
            quant_models: "NOT_RUNTIME_VERIFIED",
            python_bridge: "NOT_RUNTIME_VERIFIED",
            strategy_router: "NOT_RUNTIME_VERIFIED",
            management_assembly: "NOT_RUNTIME_VERIFIED",
            decision_assembly: "NOT_RUNTIME_VERIFIED",
            alpaca_master_paper: masterConnectionMetadata().connection_state,
            market_data: "UNKNOWN",
            option_data: "UNKNOWN",
            scheduler: localWorker.online ? "RUNNING" : "OFFLINE",
            aegis: "PARTIAL_REAL_INPUTS",
            execution: localWorker.online ? localWorker.execution_gate : masterExecutionMode,
            ledger: database.state === "CONNECTED" ? "READY" : "SCHEMA_READY_DATABASE_REQUIRED",
            reconciliation: localWorker.last_reconciliation ? "RUNNING" : database.state === "CONNECTED" ? "READY_NOT_RUNNING" : "CONTRACT_READY_DATABASE_REQUIRED",
            customer_iam: database.customer_iam ? "READY" : "BLOCKED",
            database: database.state,
            alpaca_oauth: oauth.configured ? "READY" : "BLOCKED",
            token_vault: database.token_vault && environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY ? "READY" : "BLOCKED",
            follower_adapter: "PAPER_ADAPTER_READY_EXECUTION_LOCKED",
            copy_engine: environment.DATABASE_URL ? "ORDER_INTENT_READY_EXECUTION_LOCKED" : "BLOCKED",
            followers: database.active_followers === null ? "UNKNOWN" : String(database.active_followers),
            system_errors: "UNKNOWN",
            runtime_behavior: runtimeBehavior.wait_classification,
          },
          runtime_detail: {
            stage: localWorker.online ? localWorker.state : "MASTER_PAPER_OFFLINE",
            policy_version: null,
            model_versions: ["theta-q-v0", "quant contract baselines"],
            last_market_snapshot: runtimeEvidence.last_snapshot,
            last_scan: localWorker.last_candidate_scan,
            last_decision: runtimeEvidence.last_decision,
            next_scan: null,
            candidates_evaluated: runtimeEvidence.candidates_evaluated,
            candidates_passing: null,
            candidates_rejected: null,
            candidates_waiting: null,
            candidates_q_zero: null,
            behavior_diagnostic: runtimeBehavior,
            open_positions: runtimeEvidence.open_positions,
            pending_orders: runtimeEvidence.pending_orders,
            unknown_submissions: null,
            reconciliation: localWorker.last_reconciliation ?? (database.state === "CONNECTED" ? "READY_NOT_RUNNING" : "DATABASE_REQUIRED"),
          },
          local_worker: localWorker,
          runtime_evidence: runtimeEvidence,
          outcome_research: outcomeResearch,
          provider_qualification: p2fStatus.optionomics,
          active_alerts: p2fStatus.alerts,
          p2g_evidence: p2gStatus,
          strategy_registry: strategyRegistry,
          r8_readiness: r8Readiness,
          theta_first_paper_readiness: firstPaperReadiness,
          first_paper_operational_readiness: {
            status: firstPaperReadiness.status==='READY' ? "READY" : "BLOCKED",
            blockers: firstPaperOperationalBlockers,
          },
          empirical_policy_readiness: {
            status: "BLOCKED",
            blockers: ["INSUFFICIENT_RESOLVED_PAPER_EVIDENCE"],
          },
          management_policy_promotion: { status: "NOT_PROMOTED_UNAVAILABLE" },
          paper_bootstrap_management_policy: {
            status: "READY",
            policy_version: "theta-paper-bootstrap-management-policy-v1",
            authority: "PAPER_BOOTSTRAP_MANAGEMENT_POLICY",
            empirical_profitability_claimed: false,
            new_risk_management_actions: "DISABLED",
          },
          execution_control: {
            environment: "PAPER",
            live_host_allowed: false,
            execution_tier: "PAPER_EVIDENCE",
            empirical_promotion_tier: "NOT_PROMOTED",
            live_eligible: false,
            live_authorized: false,
            empirical_economics_ready: false,
            expected_after_cost_ev_state: "UNKNOWN",
            paper_evidence_risk_cap: environment.PAPER_EVIDENCE_RISK_CAP,
            paper_evidence_eligible: localWorker.execution_gate === "ACTIVE" ? "ACTION_DEPENDENT" : "CONTROL_OR_QUOTE_BLOCKED",
            execution_quote_gate: localWorker.execution_gate === "ACTIVE" ? "PASS" : "BLOCKED",
            master_paper_execution: localWorker.online ? localWorker.execution_gate : masterExecutionMode,
            follower_paper_execution: followerExecutionMode,
            pause_new_orders: executionControl.pauseNewOrders,
            emergency_execution_lock: operatorControl.emergencyExecutionLock,
            operator_control: operatorControl,
            customer_can_enable: false,
            orders_submitted_by_release: runtimeEvidence.broker_orders,
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
            ...(localWorker.online ? [] : ["The master Paper worker is offline"]),
            ...(localWorker.execution_gate === "ACTIVE" ? [] : ["Fresh exact-contract Paper quote reference or execution control is not ready"]),
            ...(database.state === "CONNECTED" ? [] : ["Production PostgreSQL is required for durable order and reconciliation workers"]),
            "Paper evidence authorization is separate from empirical promotion and future live eligibility",
            "No validated customer performance publication",
            connectionConfigured
              ? "Private team Paper connection is available; public accounts still require Alpaca Connect approval"
              : "A configured broker credential path is required for team accounts",
          ],
          security:
            "Operator session expires in 15 minutes. Safety controls can pause or lock execution but cannot submit an order or enable trading.",
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
    if (route === "copy/results" && request.method === "GET") {
      let follower=null,tracking=null;
      if(environment.DATABASE_URL){
        const store=customerStore(environment.DATABASE_URL);
        const customer=await currentCustomer(request,store);
        if(customer){follower=await store.getFollower(customer.customerId);tracking=await store.getFollowerCopyTracking(customer.customerId);}
      }
      return send(response, 200, {
        api_version: "v1",
        dataset: "published",
        data: followerResults(follower,tracking),
      });
    }
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
    if (route === "copy/participation/state" && request.method === "POST") {
      if (!sameOrigin(request)) return send(response, 403, { error: { code: "ORIGIN_REJECTED" } });
      let store;
      try { store = customerStore(environment.DATABASE_URL); }
      catch { return send(response, 503, { error: { code: "COPY_PERSISTENCE_NOT_AVAILABLE" } }); }
      const customer = await currentCustomer(request, store);
      if (!customer) return send(response, 401, { error: { code: "LOGIN_REQUIRED" } });
      const command=z.object({command:z.enum(["PAUSE_NEW_TRADES","RESUME_NEW_TRADES"])}).strict().parse(await readJson(request));
      const saved=await store.setParticipation(customer.customerId,command.command);
      return send(response,200,{api_version:"v1",data:{participation:saved.participation,
        existing_positions_remain_managed:true,order_submission:"LOCKED"}});
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
