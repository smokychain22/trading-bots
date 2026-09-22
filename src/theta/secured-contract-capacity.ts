/** Whole cash-secured option lots supported by verified available capital. */
export function securedContractCapacity(availableCapital: number | null, collateralPerContract: number): number | null {
  if (availableCapital === null || !Number.isFinite(availableCapital) || availableCapital < 0
    || !Number.isFinite(collateralPerContract) || collateralPerContract <= 0) return null;
  return Math.floor(availableCapital / collateralPerContract);
}
