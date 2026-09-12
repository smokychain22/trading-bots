import { createHash } from "node:crypto";
import { z } from "zod";

export const copyEngineContractVersion = "theta-copy-engine-v1" as const;

export const copyActionSchema = z.enum([
  "OPEN_CSP",
  "REDUCE_CSP",
  "CLOSE_CSP",
  "ROLL_CSP",
  "ROLL_CSP_CLOSE",
  "ROLL_CSP_OPEN",
  "EXPIRE_CSP",
  "ASSIGN_STOCK",
  "HOLD_STOCK",
  "SELL_STOCK",
  "OPEN_CC",
  "REDUCE_CC",
  "CLOSE_CC",
  "ROLL_CC",
  "ROLL_CC_CLOSE",
  "ROLL_CC_OPEN",
  "EXPIRE_CC",
  "CALL_AWAY",
]);

export const followerSyncStateSchema = z.enum([
  "SYNCED",
  "PENDING_SYNC",
  "PARTIAL_SYNC",
  "DIVERGED",
  "BLOCKED",
  "RECONCILING",
]);

export const copyOutcomeSchema = z.enum([
  "COPY_FULL",
  "COPY_REDUCED",
  "SKIP_ACCOUNT",
  "BLOCKED",
  "RECONCILE",
  "DUPLICATE_NOOP",
]);

export const followerParticipationSchema = z.enum([
  "COPY_NEW_AND_MANAGE",
  "STOP_NEW_TRADES_MANAGE_EXISTING",
  "DISCONNECTED",
]);

export const masterCopyEventSchema = z.object({
  masterDecisionId: z.string().min(1).nullable(),
  masterLifecycleId: z.string().min(1),
  masterOrderId: z.string().min(1).nullable(),
  masterFillId: z.string().min(1).nullable(),
  action: copyActionSchema,
  symbol: z.string().min(1),
  contractId: z.string().min(1).nullable(),
  masterQuantity: z.number().int().nonnegative(),
  masterFilledQuantity: z.number().int().nonnegative(),
  occurredAt: z.string().datetime({ offset: true }),
}).superRefine((event, context) => {
  if (event.masterFilledQuantity > event.masterQuantity) {
    context.addIssue({
      code: "custom",
      message: "masterFilledQuantity cannot exceed masterQuantity",
    });
  }
});

export const followerCopyStateSchema = z.object({
  followerId: z.string().min(1),
  policyVersion: z.string().min(1),
  participation: followerParticipationSchema,
  accountReady: z.boolean(),
  optionsApproved: z.boolean(),
  authorizedCapitalRemaining: z.number().finite().nonnegative(),
  collateralPerContract: z.number().finite().positive(),
  maxContractsPerPosition: z.number().int().nonnegative(),
  existingCopiedQuantity: z.number().int().nonnegative(),
  actualBrokerQuantity: z.number().int().nonnegative(),
  chainEntryParticipated: z.boolean(),
  assignmentCapacityContracts: z.number().int().nonnegative().nullable(),
  tailCapacityContracts: z.number().int().nonnegative().nullable(),
  concentrationCapacityContracts: z.number().int().nonnegative().nullable(),
  accountLimitContracts: z.number().int().nonnegative().nullable(),
  actualCoveredShares: z.number().int().nonnegative().nullable(),
  contractMultiplier: z.number().int().positive().nullable(),
  followerBrokerLifecycleConfirmed: z.boolean(),
  freshFollowerQuote: z.boolean(),
  expectedSlippagePerContract: z.number().finite().nonnegative().nullable(),
  maxSlippagePerContract: z.number().finite().nonnegative(),
  brokerOrderState: z.enum([
    "NONE",
    "PENDING",
    "PARTIAL_FILL",
    "FILLED",
    "REJECTED",
    "UNKNOWN_SUBMISSION",
  ]),
  processedCopyEventIds: z.array(z.string().min(1)),
  followerAssigned: z.boolean().nullable(),
});

export type MasterCopyEvent = z.infer<typeof masterCopyEventSchema>;
export type FollowerCopyState = z.infer<typeof followerCopyStateSchema>;
export type FollowerSyncState = z.infer<typeof followerSyncStateSchema>;
export type CopyOutcome = z.infer<typeof copyOutcomeSchema>;

export interface FollowerCopyPlan {
  readonly contractVersion: typeof copyEngineContractVersion;
  readonly copyEventId: string;
  readonly followerOrderIntentId: string;
  readonly clientOrderId: string;
  readonly action: MasterCopyEvent["action"];
  readonly outcome: CopyOutcome;
  readonly syncState: FollowerSyncState;
  readonly intendedQuantity: number;
  readonly closeQuantity: number;
  readonly openQuantity: number;
  readonly executionAuthorized: false;
  readonly nextAction: "PERSIST_PLAN" | "RECONCILE" | "NONE";
  readonly reason:
    | "FULL_ACCOUNT_CAPACITY"
    | "FOLLOWER_QUANTITY_REDUCED"
    | "INSUFFICIENT_AUTHORIZED_CAPITAL"
    | "FOLLOWER_NOT_READY"
    | "OPTIONS_NOT_APPROVED"
    | "FOLLOWER_DISCONNECTED"
    | "NEW_TRADES_STOPPED"
    | "STALE_FOLLOWER_QUOTE"
    | "SLIPPAGE_LIMIT_EXCEEDED"
    | "EXECUTION_ECONOMICS_UNKNOWN"
    | "FOLLOWER_CAPACITY_UNKNOWN"
    | "FOLLOWER_SKIPPED_ENTRY"
    | "FOLLOWER_BROKER_LIFECYCLE_UNCONFIRMED"
    | "INSUFFICIENT_FOLLOWER_COVERED_SHARES"
    | "ROLL_REQUIRES_EXPLICIT_LEGS"
    | "BROKER_REJECTED"
    | "UNKNOWN_SUBMISSION_REQUIRES_RECONCILIATION"
    | "BROKER_POSITION_DIVERGED"
    | "ASSIGNMENT_DIVERGED"
    | "PARTIAL_FILL_REQUIRES_RECONCILIATION"
    | "DUPLICATE_COPY_EVENT";
}

const stableId = (prefix: string, values: readonly string[]) =>
  `${prefix}_${createHash("sha256").update(values.join("\u001f")).digest("hex").slice(0, 32)}`;

export function copyEventId(event: MasterCopyEvent, followerId: string): string {
  const parsed = masterCopyEventSchema.parse(event);
  return stableId("copy", [
    parsed.masterDecisionId ?? "none",
    parsed.masterLifecycleId,
    parsed.masterOrderId ?? "none",
    parsed.masterFillId ?? "none",
    parsed.action,
    followerId,
  ]);
}

export function followerClientOrderId(copyId: string, attempt = 1): string {
  if (!Number.isInteger(attempt) || attempt < 1)
    throw new Error("attempt must be an explicit positive integer");
  return stableId("theta_follower", [copyId, String(attempt)]);
}

const opensNewStandaloneRisk = (action: MasterCopyEvent["action"]) =>
  action === "OPEN_CSP" || action === "ROLL_CSP_OPEN";

const closesExposure = (action: MasterCopyEvent["action"]) =>
  ["REDUCE_CSP", "CLOSE_CSP", "ROLL_CSP_CLOSE", "SELL_STOCK", "REDUCE_CC", "CLOSE_CC", "ROLL_CC_CLOSE"].includes(action);

const lifecycleManagement = (action: MasterCopyEvent["action"]) =>
  [
    "EXPIRE_CSP",
    "ASSIGN_STOCK",
    "HOLD_STOCK",
    "OPEN_CC",
    "ROLL_CC_OPEN",
    "EXPIRE_CC",
    "CALL_AWAY",
  ].includes(action);

function basePlan(
  event: MasterCopyEvent,
  follower: FollowerCopyState,
): Omit<FollowerCopyPlan, "outcome" | "syncState" | "intendedQuantity" | "closeQuantity" | "openQuantity" | "nextAction" | "reason"> {
  const id = copyEventId(event, follower.followerId);
  return {
    contractVersion: copyEngineContractVersion,
    copyEventId: id,
    followerOrderIntentId: stableId("intent", [id, follower.policyVersion]),
    clientOrderId: followerClientOrderId(id),
    action: event.action,
    executionAuthorized: false,
  };
}

function blocked(
  base: ReturnType<typeof basePlan>,
  reason: FollowerCopyPlan["reason"],
  syncState: FollowerSyncState = "BLOCKED",
  nextAction: FollowerCopyPlan["nextAction"] = "NONE",
): FollowerCopyPlan {
  return {
    ...base,
    outcome: nextAction === "RECONCILE" ? "RECONCILE" : "BLOCKED",
    syncState,
    intendedQuantity: 0,
    closeQuantity: 0,
    openQuantity: 0,
    nextAction,
    reason,
  };
}

export function planFollowerCopy(
  rawEvent: MasterCopyEvent,
  rawFollower: FollowerCopyState,
): FollowerCopyPlan {
  const event = masterCopyEventSchema.parse(rawEvent);
  const follower = followerCopyStateSchema.parse(rawFollower);
  const base = basePlan(event, follower);

  if (event.action === "ROLL_CSP" || event.action === "ROLL_CC")
    return blocked(base, "ROLL_REQUIRES_EXPLICIT_LEGS");

  if (follower.processedCopyEventIds.includes(base.copyEventId)) {
    return {
      ...base,
      outcome: "DUPLICATE_NOOP",
      syncState: "SYNCED",
      intendedQuantity: 0,
      closeQuantity: 0,
      openQuantity: 0,
      nextAction: "NONE",
      reason: "DUPLICATE_COPY_EVENT",
    };
  }
  if (follower.brokerOrderState === "UNKNOWN_SUBMISSION")
    return blocked(base, "UNKNOWN_SUBMISSION_REQUIRES_RECONCILIATION", "RECONCILING", "RECONCILE");
  if (follower.brokerOrderState === "PARTIAL_FILL")
    return blocked(base, "PARTIAL_FILL_REQUIRES_RECONCILIATION", "PARTIAL_SYNC", "RECONCILE");
  if (follower.brokerOrderState === "REJECTED")
    return blocked(base, "BROKER_REJECTED", "BLOCKED", "RECONCILE");
  if (follower.participation === "DISCONNECTED")
    return blocked(base, "FOLLOWER_DISCONNECTED", "BLOCKED", "RECONCILE");
  if (!follower.accountReady)
    return blocked(base, "FOLLOWER_NOT_READY");
  if (!follower.optionsApproved && event.contractId !== null)
    return blocked(base, "OPTIONS_NOT_APPROVED");

  if (event.action !== "OPEN_CSP" && !follower.chainEntryParticipated)
    return blocked(base, "FOLLOWER_SKIPPED_ENTRY");

  if (["EXPIRE_CSP", "ASSIGN_STOCK", "EXPIRE_CC", "CALL_AWAY"].includes(event.action)
    && !follower.followerBrokerLifecycleConfirmed)
    return blocked(base, "FOLLOWER_BROKER_LIFECYCLE_UNCONFIRMED", "RECONCILING", "RECONCILE");

  if (follower.actualBrokerQuantity !== follower.existingCopiedQuantity && follower.existingCopiedQuantity > 0)
    return blocked(base, "BROKER_POSITION_DIVERGED", "DIVERGED", "RECONCILE");
  if (event.action === "ASSIGN_STOCK" && follower.followerAssigned === false)
    return blocked(base, "ASSIGNMENT_DIVERGED", "DIVERGED", "RECONCILE");

  if (opensNewStandaloneRisk(event.action) && follower.participation === "STOP_NEW_TRADES_MANAGE_EXISTING")
    return blocked(base, "NEW_TRADES_STOPPED");

  const masterQuantity = event.masterFilledQuantity;
  const managementQuantity = Math.min(masterQuantity, follower.existingCopiedQuantity);
  if ((event.action === "OPEN_CC" || event.action === "ROLL_CC_OPEN") &&
    (follower.actualCoveredShares === null || follower.contractMultiplier === null ||
      follower.actualCoveredShares < managementQuantity * follower.contractMultiplier))
    return blocked(base, "INSUFFICIENT_FOLLOWER_COVERED_SHARES");

  const requiresExecutableQuote = opensNewStandaloneRisk(event.action) || closesExposure(event.action) || ["OPEN_CC", "ROLL_CC_OPEN"].includes(event.action);
  if (requiresExecutableQuote && !follower.freshFollowerQuote)
    return blocked(base, "STALE_FOLLOWER_QUOTE");
  if (
    requiresExecutableQuote &&
    follower.expectedSlippagePerContract === null
  ) return blocked(base, "EXECUTION_ECONOMICS_UNKNOWN");
  if (
    requiresExecutableQuote && follower.expectedSlippagePerContract !== null &&
      follower.expectedSlippagePerContract > follower.maxSlippagePerContract
  )
    return blocked(base, "SLIPPAGE_LIMIT_EXCEEDED");

  const collateralCapacity = Math.min(
    follower.maxContractsPerPosition,
    Math.floor(follower.authorizedCapitalRemaining / follower.collateralPerContract),
  );
  const riskCapacities = [follower.assignmentCapacityContracts,follower.tailCapacityContracts,
    follower.concentrationCapacityContracts];
  if (opensNewStandaloneRisk(event.action) && riskCapacities.some((value) => value === null))
    return blocked(base, "FOLLOWER_CAPACITY_UNKNOWN");
  const capacity = Math.min(collateralCapacity,...riskCapacities.map((value) => value ?? 0),
    follower.accountLimitContracts ?? Number.POSITIVE_INFINITY);
  const intendedQuantity = opensNewStandaloneRisk(event.action)
    ? Math.min(masterQuantity, capacity)
    : closesExposure(event.action) || lifecycleManagement(event.action)
      ? managementQuantity
      : 0;
  const closeQuantity = closesExposure(event.action)
    ? managementQuantity
    : 0;
  const openQuantity = opensNewStandaloneRisk(event.action)
    ? intendedQuantity
    : event.action === "OPEN_CC" || event.action === "ROLL_CC_OPEN"
      ? managementQuantity
      : 0;

  if (intendedQuantity === 0 && masterQuantity > 0) {
    return {
      ...base,
      outcome: "SKIP_ACCOUNT",
      syncState: "BLOCKED",
      intendedQuantity: 0,
      closeQuantity,
      openQuantity: 0,
      nextAction: "NONE",
      reason: "INSUFFICIENT_AUTHORIZED_CAPITAL",
    };
  }
  const outcome = intendedQuantity === masterQuantity ? "COPY_FULL" : "COPY_REDUCED";
  return {
    ...base,
    outcome,
    syncState: "PENDING_SYNC",
    intendedQuantity,
    closeQuantity,
    openQuantity,
    nextAction: "PERSIST_PLAN",
    reason: outcome === "COPY_FULL" ? "FULL_ACCOUNT_CAPACITY" : "FOLLOWER_QUANTITY_REDUCED",
  };
}

export type OrderCashflowDirection = "CREDIT" | "DEBIT";
export interface PriceDeterioration {
  readonly direction:OrderCashflowDirection;
  readonly amount:number;
  readonly classification:"ADVERSE"|"UNCHANGED"|"IMPROVED";
}

export function directionAwarePriceDeterioration(input:{
  readonly direction:OrderCashflowDirection; readonly masterPrice:number; readonly followerPrice:number;
}):PriceDeterioration {
  const parsed=z.object({direction:z.enum(["CREDIT","DEBIT"]),masterPrice:z.number().finite().nonnegative(),
    followerPrice:z.number().finite().nonnegative()}).parse(input);
  const raw=parsed.direction==="CREDIT" ? parsed.masterPrice-parsed.followerPrice : parsed.followerPrice-parsed.masterPrice;
  const amount=Math.abs(raw)<1e-12?0:raw;
  return {direction:parsed.direction,amount,classification:amount>0?"ADVERSE":amount<0?"IMPROVED":"UNCHANGED"};
}

export function syncStateAfterBrokerResult(input: {
  readonly intendedQuantity: number;
  readonly filledQuantity: number;
  readonly brokerState: "FILLED" | "PARTIAL_FILL" | "REJECTED" | "UNKNOWN_SUBMISSION";
}): FollowerSyncState {
  const parsed = z.object({
    intendedQuantity: z.number().int().nonnegative(),
    filledQuantity: z.number().int().nonnegative(),
    brokerState: z.enum(["FILLED", "PARTIAL_FILL", "REJECTED", "UNKNOWN_SUBMISSION"]),
  }).parse(input);
  if (parsed.brokerState === "UNKNOWN_SUBMISSION") return "RECONCILING";
  if (parsed.brokerState === "REJECTED") return "BLOCKED";
  if (parsed.brokerState === "PARTIAL_FILL" || parsed.filledQuantity < parsed.intendedQuantity)
    return "PARTIAL_SYNC";
  return parsed.filledQuantity === parsed.intendedQuantity ? "SYNCED" : "DIVERGED";
}
