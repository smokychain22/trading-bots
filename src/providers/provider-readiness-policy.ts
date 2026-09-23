import type { CheckResult } from './readiness.js';

/**
 * The readiness command reports every capability independently. Its process
 * status answers the narrower question, "is the configured THETA Paper data
 * path usable?" OPRA remains truthfully NOT_ENTITLED when the account lacks
 * it, but that optional entitlement cannot fail the Paper path when Alpaca's
 * distinct indicative option feed is GOOD.
 */
export function providerReadinessHasBlockingFailure(results: readonly CheckResult[]): boolean {
  const indicativeReady = results.some((result) =>
    result.provider === 'ALPACA'
      && result.capability === 'OPTIONS_MARKET_DATA_INDICATIVE'
      && result.state === 'GOOD');

  return results.some((result) => {
    if (result.state === 'GOOD') return false;
    if (result.provider === 'ALPACA'
      && result.capability === 'OPTIONS_MARKET_DATA_OPRA'
      && result.state === 'NOT_ENTITLED'
      && indicativeReady) return false;
    return true;
  });
}
