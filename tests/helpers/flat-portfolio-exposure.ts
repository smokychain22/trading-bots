import { deriveAccountExposure } from '../../src/theta/account-exposure.js';

/** A typed, broker-flat fixture for snapshot shape tests. */
export function flatPortfolioExposure() {
  return { ...deriveAccountExposure(null, [], []), correlationObservation: null };
}
