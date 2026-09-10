import type { Environment } from "../config/environment.js";
import { missingProviderVariables } from "../config/environment.js";
import { checkOptionomics, type CheckResult } from "../providers/readiness.js";

export type OptionomicsReadiness = {
  readonly provider: "OPTIONOMICS";
  readonly state: "CONNECTED" | "INVALID" | "MISSING" | "DEGRADED";
  readonly checked_at: string;
  readonly latency_ms: number | null;
  readonly capabilities: ReadonlyArray<{
    capability: string;
    operation_alias: string;
    state: string;
    http_status: number | null;
    observed_at: string;
  }>;
};

export function summarizeOptionomicsReadiness(
  results: readonly CheckResult[],
): OptionomicsReadiness {
  const states = results.map((result) => result.state);
  const state = states.length > 1 && states.every((item) => item === "GOOD")
    ? "CONNECTED"
    : states.some((item) => item === "INVALID")
      ? "INVALID"
      : "DEGRADED";
  return {
    provider: "OPTIONOMICS",
    state,
    checked_at: results.at(-1)?.observedAt ?? new Date().toISOString(),
    latency_ms: results.reduce<number | null>(
      (total, item) => item.latencyMs === null ? total : (total ?? 0) + item.latencyMs,
      null,
    ),
    capabilities: results.map((result) => ({
      capability: result.capability,
      operation_alias: result.operationAlias,
      state: result.state,
      http_status: result.httpStatus,
      observed_at: result.observedAt,
    })),
  };
}

export async function verifyOptionomicsConnection(
  environment: Environment,
): Promise<OptionomicsReadiness> {
  if (missingProviderVariables(environment, "OPTIONOMICS").length > 0) {
    return {
      provider: "OPTIONOMICS",
      state: "MISSING",
      checked_at: new Date().toISOString(),
      latency_ms: null,
      capabilities: [],
    };
  }
  return summarizeOptionomicsReadiness(await checkOptionomics(environment));
}

export const privatePaperBetaReadiness = (followerCount: number | null) => ({
  state: "IMPLEMENTED_CONFIGURATION_GATED" as const,
  policy_status: "PRIVATE_TEAM_PAPER_ONLY" as const,
  reason: "Private team credentials are encrypted server-side. Order submission remains locked.",
  follower_count: followerCount,
  raw_key_endpoint_available: true,
});
