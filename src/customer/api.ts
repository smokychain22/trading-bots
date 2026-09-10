import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { botDetail, botSummaries } from "./catalog.js";
import { matchesOperatorToken } from "../providers/readiness-handler.js";
import { loadEnvironment } from "../config/environment.js";
import {
  masterConnectionMetadata,
  paperCopyReadiness,
  reviewPaperCopyPolicy,
  verifyMasterPaperConnection,
} from "./paper-copy.js";

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
      if (route === "operator/master-readiness" && request.method === "POST") {
        try {
          const data = await verifyMasterPaperConnection(loadEnvironment());
          return send(response, data.connection_state === "GOOD" ? 200 : 207, {
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
      if (request.method !== "GET")
        return send(response, 405, { error: { code: "READ_ONLY_OPERATOR" } });
      if (route !== "operator/status")
        return send(response, 404, { error: { code: "NOT_FOUND" } });
      return send(response, 200, {
        api_version: "v1",
        data: {
          website:
            process.env.VERCEL_ENV === "production"
              ? "PRODUCTION"
              : "DEVELOPMENT_OR_PREVIEW",
          trading: "DISABLED",
          bot_mode: "PAPER",
          copy: "BLOCKED",
          deployment_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
          provider_runtime: "UNKNOWN",
          systems: {
            theta_runtime: "BLOCKED",
            quant_models: "HEALTHY",
            decision_assembly: "HEALTHY",
            alpaca_master_paper: "UNKNOWN",
            market_data: "UNKNOWN",
            option_data: "UNKNOWN",
            scheduler: "BLOCKED",
            aegis: "HEALTHY",
            execution: "BLOCKED",
            ledger: "BLOCKED",
            reconciliation: "BLOCKED",
            copy_engine: "BLOCKED",
            followers: "UNKNOWN",
            system_errors: "UNKNOWN",
          },
          runtime_detail: {
            stage: "R1_PARTIAL",
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
            reconciliation: "NOT_IMPLEMENTED",
          },
          master_connection: masterConnectionMetadata(),
          published_performance: false,
          gates: [
            "OPRA entitlement not established for execution",
            "No validated customer performance publication",
            "Copy execution and customer account isolation not released",
          ],
          security:
            "Operator session expires in 15 minutes. Read-only release visibility. No trading mutations are exposed.",
          connection_change_policy:
            "Master credentials are managed through secure deployment configuration. Disconnect and reconnect require an audited secret-reference change and are not exposed in this UI.",
        },
      });
    }
    if (route === "copy/readiness" && request.method === "GET")
      return send(response, 200, {
        api_version: "v1",
        product_extension: "THETA_v1.2_PAPER_COPY",
        data: paperCopyReadiness(),
      });
    if (route === "copy/policy/validate" && request.method === "POST")
      return send(response, 200, {
        api_version: "v1",
        product_extension: "THETA_v1.2_PAPER_COPY",
        data: reviewPaperCopyPolicy(await readJson(request)),
      });
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
