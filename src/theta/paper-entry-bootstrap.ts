export const paperEntryBootstrapPolicyVersion = 'theta-paper-entry-bootstrap-v1' as const;

export type PaperEntryBootstrapState =
  | 'DISABLED'
  | 'BLOCKED_HARD_SAFETY'
  | 'ELIGIBLE_UNCALIBRATED';

export interface PaperEntryBootstrapInput {
  readonly enabled: boolean;
  readonly runtimeMode: string;
  readonly brokerEnvironment: 'PAPER' | 'LIVE' | 'UNKNOWN';
  readonly accountStatus: string | null;
  readonly reconciliationQuality: 'GOOD' | 'UNKNOWN';
  readonly localOnlyIntentCount: number;
  readonly externalOrUnknownOrderCount: number;
  readonly marketOpen: boolean | null;
  readonly calendarSessionConfirmed: boolean;
  readonly followerExecutionEnabled: boolean;
  readonly liveMoneyAuthorized: boolean;
}

export interface PaperEntryBootstrapAssessment {
  readonly state: PaperEntryBootstrapState;
  readonly policyVersion: typeof paperEntryBootstrapPolicyVersion;
  readonly eligibilityTier: 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED' | null;
  readonly hardBlockers: readonly string[];
  readonly executionAuthorized: false;
}

export function classifyAlpacaBrokerEnvironment(baseUrl:string):PaperEntryBootstrapInput['brokerEnvironment']{
  try{
    const parsed=new URL(baseUrl);
    if(parsed.protocol==='https:'&&parsed.hostname==='paper-api.alpaca.markets'&&parsed.pathname==='/')return 'PAPER';
    if(parsed.hostname==='api.alpaca.markets')return 'LIVE';
    return 'UNKNOWN';
  }catch{return 'UNKNOWN';}
}

/**
 * Separates Paper cold-start eligibility from model calibration. Passing this
 * contract never supplies alpha, ownership quality, expected value, or an
 * execution authorization. It only proves that the dedicated master Paper
 * runtime is in a sufficiently clean state to let the normal candidate,
 * AEGIS, sizing, quote, and order-control gates continue evaluating.
 */
export function assessPaperEntryBootstrap(input: PaperEntryBootstrapInput): PaperEntryBootstrapAssessment {
  if (!input.enabled) return {
    state: 'DISABLED', policyVersion: paperEntryBootstrapPolicyVersion,
    eligibilityTier: null, hardBlockers: ['PAPER_ENTRY_BOOTSTRAP_DISABLED'], executionAuthorized: false,
  };
  const hardBlockers: string[] = [];
  if (input.runtimeMode !== 'MASTER_THETA_PAPER') hardBlockers.push('MASTER_THETA_PAPER_RUNTIME_REQUIRED');
  if (input.brokerEnvironment !== 'PAPER') hardBlockers.push('PAPER_BROKER_REQUIRED');
  if (input.accountStatus !== 'ACTIVE') hardBlockers.push('MASTER_ACCOUNT_NOT_ACTIVE');
  if (input.reconciliationQuality !== 'GOOD') hardBlockers.push('BROKER_RECONCILIATION_NOT_GOOD');
  if (input.localOnlyIntentCount !== 0) hardBlockers.push('LOCAL_ONLY_ORDER_INTENT_PRESENT');
  if (input.externalOrUnknownOrderCount !== 0) hardBlockers.push('EXTERNAL_OR_UNKNOWN_BROKER_ORDER_PRESENT');
  if (input.marketOpen !== true || !input.calendarSessionConfirmed) hardBlockers.push('OPTION_MARKET_SESSION_UNCONFIRMED');
  if (input.followerExecutionEnabled) hardBlockers.push('FOLLOWER_EXECUTION_MUST_REMAIN_LOCKED');
  if (input.liveMoneyAuthorized) hardBlockers.push('LIVE_MONEY_MUST_REMAIN_DISABLED');
  return hardBlockers.length > 0 ? {
    state: 'BLOCKED_HARD_SAFETY', policyVersion: paperEntryBootstrapPolicyVersion,
    eligibilityTier: null, hardBlockers, executionAuthorized: false,
  } : {
    state: 'ELIGIBLE_UNCALIBRATED', policyVersion: paperEntryBootstrapPolicyVersion,
    eligibilityTier: 'PAPER_ENTRY_BOOTSTRAP_UNCALIBRATED', hardBlockers: [], executionAuthorized: false,
  };
}
