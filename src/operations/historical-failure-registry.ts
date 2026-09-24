export const historicalFailureRegistryVersion = 'theta-historical-live-failure-registry-v1' as const;

export interface HistoricalFailureRegression {
  readonly fixtureId: `F${string}`;
  readonly failureFingerprint: string;
  readonly inputFamilies: readonly string[];
  readonly expectedTypedResult: string;
  readonly testFiles: readonly string[];
  readonly proofPattern: string;
}

const fixture = (fixtureId: HistoricalFailureRegression['fixtureId'], failureFingerprint: string,
  expectedTypedResult: string, testFiles: readonly string[], proofPattern: string,
  inputFamilies: readonly string[] = ['RUNTIME_STATE']): HistoricalFailureRegression => ({
  fixtureId, failureFingerprint, inputFamilies, expectedTypedResult, testFiles, proofPattern,
});

/**
 * Executable, sanitized index of every retained live failure family. The
 * referenced tests carry deterministic inputs and assertions. Provider
 * credentials, account identifiers, and raw payloads are deliberately absent.
 */
export const historicalFailureRegressions: readonly HistoricalFailureRegression[] = [
  fixture('F01_POSTGRES_CHECKED_OUT_CLIENT_LOST', 'checked-out client emitted error',
    'POSTGRES_CHECKED_OUT_CLIENT_LOST', ['tests/runtime-postgres-client.test.ts'], 'checked-out client error'),
  fixture('F02_POSTGRES_CONNECTION_TERMINATED_CLASSIFIER_MISMATCH', 'connection text lost its typed state',
    'POSTGRES_CONNECTION_TERMINATED', ['tests/runtime-postgres-client.test.ts'], 'connection terminated'),
  fixture('F03_UNBOUNDED_DIAGNOSTIC', 'provider diagnostic exceeded bounded deadline',
    'BOUNDED_PROVIDER_TIMEOUT', ['tests/alpaca-provider.test.ts'], 'abort|timeout'),
  fixture('F04_MA200_HISTORY_TOO_SHORT', 'calendar lookback could not produce MA200',
    'MA200_HISTORY_REQUEST_SUFFICIENT', ['tests/theta-shadow-once-config.test.ts'], 'MA200'),
  fixture('F05_COMPOSITE_OWNERSHIP_UNKNOWN', 'partial ownership silently cleared',
    'OWNERSHIP_UNKNOWN_FAIL_CLOSED', ['tests/ownership-contract.test.ts'], 'UNKNOWN|unknown'),
  fixture('F06_FALSE_BROKER_QTY_ZERO', 'missing account evidence looked like zero capacity',
    'BROKER_QTY_UNKNOWN_NOT_ZERO', ['tests/strategy-account-policy-compatibility.test.ts'], 'brokerAllowedQty'),
  fixture('F07_SPY_CSP_72_PERCENT_VS_15_PERCENT', 'secured-put minimum concentration exceeded bootstrap policy',
    'ACCOUNT_POLICY_INCOMPATIBLE', ['tests/strategy-account-policy-compatibility.test.ts'], '0[.]72|72_000'),
  fixture('F08_AEGIS_BASELINE_ACCUMULATING', 'immature history looked like no stress',
    'BASELINE_ACCUMULATING', ['tests/aegis-stress-baseline-maturity.test.ts'], 'ACCUMULATING'),
  fixture('F09_POOL_ERROR_ESCAPED_FALLBACK', 'pool error escaped runtime fallback',
    'SANITIZED_POOL_FAILURE', ['tests/runtime-postgres-pool.test.ts'], 'checked-out Postgres disconnect'),
  fixture('F10_STALE_IEX_QUOTE_FRESH_TRADE', 'fresh trade gained option execution authority',
    'TRADE_REFERENCE_ONLY', ['tests/option-chain-ingestion.test.ts'], 'fresh IEX trade'),
  fixture('F11_THETA_PROCESSING_CREATED_STALENESS', 'internal processing exhausted quote age',
    'FINALIST_QUOTE_REFRESH_REQUIRED', ['tests/finalist-quote-refresh.test.ts'], 'refresh'),
  fixture('F12_SAME_SESSION_BASELINE_INFLATION', 'poll count inflated independent baseline N',
    'INDEPENDENT_SESSION_BASELINE', ['tests/aegis-alpaca-iv-stress.test.ts'], 'same session'),
  fixture('F13_POSTGRES_57P03', 'database temporarily rejected connections',
    'POSTGRES_57P03', ['tests/runtime-postgres-client.test.ts'], '57P03'),
  fixture('F14_LEASE_RENEWAL_GAP', 'worker lease expired during bounded work',
    'LEASE_RENEWED_OR_FAIL_CLOSED', ['tests/runtime-request-lease.test.ts'], 'outlives the bounded server request'),
  fixture('F15_AEGIS_UNKNOWN_ZERO_SIZING', 'AEGIS uncertainty collapsed to numeric zero',
    'AEGIS_UNKNOWN_TYPED', ['tests/new-risk-orchestrator.test.ts'], 'global UNKNOWN'),
  fixture('F16_EVENT_NEGATIVE_ASSURANCE_UNPROVEN', 'empty events response looked clear',
    'EVENT_COVERAGE_PROVIDER_LIMITED', ['tests/macro-event-policy.test.ts'], 'negative|coverage'),
  fixture('F17_CORP_ACTION_NEGATIVE_ASSURANCE_UNPROVEN', 'empty corporate action response looked clear',
    'CORPORATE_ACTION_COVERAGE_PROVIDER_LIMITED', ['tests/alpaca-corporate-action-evidence.test.ts'], 'negative|coverage'),
  fixture('F18_HD_RESEARCH_POISONING_Q', 'research-only H or D absence blocked Q',
    'Q_REMAINS_INDEPENDENT', ['tests/canonical-strategy-frontier.test.ts'], 'research-only H'),
  fixture('F19_Q_ECONOMIC_WINNER_AUTHORITY', 'structural or lexical candidate replaced Q economics',
    'Q_ECONOMIC_WINNER_REQUIRED', ['tests/canonical-strategy-frontier.test.ts'], 'economic winner'),
  fixture('F20_NO_CANDIDATE_NOT_EQUAL_NO_OPPORTUNITY', 'incomplete enumeration became NO_OPPORTUNITY',
    'DATA_INSUFFICIENT_NOT_NO_OPPORTUNITY', ['tests/decision-assembly.test.ts'], 'no candidates'),
  fixture('F21_OPTIONOMICS_EXECUTION_AUTHORITY_LEAK', 'research quote became executable authority',
    'ALPACA_EXECUTABLE_MARKET_ONLY', ['tests/trusted-option-quote.test.ts'], 'research only, never execution'),
  fixture('F22_POSTGRES_57014_QUERY_TIMEOUT', 'statement timeout lost typed retry semantics',
    'POSTGRES_57014', ['tests/runtime-postgres-client.test.ts'], '57014'),
  fixture('F23_AIVEN_53000_TRANSFER_QUOTA', 'optional bulk archive retried through exhausted transfer quota',
    'TRANSFER_QUOTA_EXHAUSTED_COOLDOWN', ['tests/local-research-archive-health.test.ts'], 'quota exhaustion'),
] as const;

export function validateHistoricalFailureRegistry(): readonly string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const item of historicalFailureRegressions) {
    if (ids.has(item.fixtureId)) issues.push(`DUPLICATE_FIXTURE:${item.fixtureId}`);
    ids.add(item.fixtureId);
    if (item.testFiles.length === 0) issues.push(`NO_EXECUTABLE_TEST:${item.fixtureId}`);
    if (item.inputFamilies.length === 0) issues.push(`NO_INPUT_FAMILY:${item.fixtureId}`);
  }
  for (let index = 1; index <= 23; index += 1) {
    const prefix = `F${String(index).padStart(2, '0')}_`;
    if (![...ids].some((id) => id.startsWith(prefix))) issues.push(`MISSING_FIXTURE:${prefix}`);
  }
  return issues;
}
