/**
 * Whole contracts `capital` can secure at `collateralPerContract`, computed on integer cents so decimal-noise collateral
 * (strike * multiplier = 1.09 * 100 = 109.00000000000001) cannot under-size an exact fit. Collateral is rounded UP and
 * capital rounded DOWN at sub-cent precision, so the helper can never over-size. Invalid input is UNKNOWN (null).
 */
export function wholeContractsAffordable(capital: number | null, collateralPerContract: number | null): number | null {
  if (capital === null || collateralPerContract === null || !Number.isFinite(capital) || capital < 0
    || !Number.isFinite(collateralPerContract) || collateralPerContract <= 0) return null;
  // Round to micro-dollars first to strip binary noise, then convert to cents (ceil collateral, floor capital).
  const capitalCents = Math.floor(Math.round(capital * 1e6) / 1e4);
  const collateralCents = Math.ceil(Math.round(collateralPerContract * 1e6) / 1e4);
  if (!Number.isSafeInteger(capitalCents) || !Number.isSafeInteger(collateralCents) || collateralCents <= 0) return null;
  return Math.floor(capitalCents / collateralCents);
}

/** Whole cash-secured option lots, including only independently verified already-secured lots. */
export function securedContractCapacity(availableCapital: number | null, collateralPerContract: number,
  alreadySecuredLots = 0): number | null {
  if (availableCapital === null || !Number.isFinite(availableCapital) || availableCapital < 0
    || !Number.isFinite(collateralPerContract) || collateralPerContract <= 0
    || !Number.isSafeInteger(alreadySecuredLots) || alreadySecuredLots < 0) return null;
  const affordable = wholeContractsAffordable(availableCapital, collateralPerContract);
  return affordable === null ? null : alreadySecuredLots + affordable;
}

/**
 * Whole covered-call contracts that can still be opened: floor(coveredShares / multiplier) minus
 * contracts already covered by open short calls minus pending sell-to-open call contracts, never
 * negative, never naked. Any unknown or invalid input yields null (UNKNOWN), never zero-by-coercion.
 */
export function coveredCallContractCapacity(coveredShares: number | null, alreadyCoveredContracts: number | null,
  pendingShortCallContracts: number | null, multiplier = 100): number | null {
  if (coveredShares === null || alreadyCoveredContracts === null || pendingShortCallContracts === null) return null;
  if (!Number.isFinite(coveredShares) || coveredShares < 0 || !Number.isSafeInteger(multiplier) || multiplier <= 0
    || !Number.isSafeInteger(alreadyCoveredContracts) || alreadyCoveredContracts < 0
    || !Number.isSafeInteger(pendingShortCallContracts) || pendingShortCallContracts < 0) return null;
  return Math.max(0, Math.floor(coveredShares / multiplier) - alreadyCoveredContracts - pendingShortCallContracts);
}
