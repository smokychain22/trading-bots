export const getOnlyFetchPolicyVersion = 'theta-get-only-fetch-v1' as const;

/**
 * Wraps a fetch implementation with a physical GET-only boundary. The method
 * can come from RequestInit or from a prebuilt Request, so checking init alone
 * is insufficient. Bodies are rejected as well. This adapter has no broker
 * mutation surface and never rewrites a prohibited request into GET.
 */
export function createGetOnlyFetch(
  fetchImpl: typeof fetch,
  errorCode: string,
): typeof fetch {
  if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(errorCode)) throw new Error('GET_ONLY_FETCH_ERROR_CODE_INVALID');
  return (input, init) => {
    const request = input instanceof Request ? input : null;
    const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (method !== 'GET' || init?.body != null || request?.body != null) throw new Error(errorCode);
    return fetchImpl(input, init);
  };
}
