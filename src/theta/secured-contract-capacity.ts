/** Whole cash-secured option lots, including only independently verified already-secured lots. */
export function securedContractCapacity(availableCapital: number | null, collateralPerContract: number,
  alreadySecuredLots = 0): number | null {
  if (availableCapital === null || !Number.isFinite(availableCapital) || availableCapital < 0
    || !Number.isFinite(collateralPerContract) || collateralPerContract <= 0
    || !Number.isSafeInteger(alreadySecuredLots) || alreadySecuredLots < 0) return null;
  return alreadySecuredLots + Math.floor(availableCapital / collateralPerContract);
}
