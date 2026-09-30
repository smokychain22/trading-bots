/** Protocol codes only. Error names/messages/URLs may contain credentials. */
export function providerNetworkFailureCode(error: unknown): string {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object' && !seen.has(current); depth++) {
    seen.add(current);
    const value = current as { code?: unknown; cause?: unknown };
    const code = typeof value.code === 'string' ? value.code : '';
    if (['EAI_AGAIN', 'ENOTFOUND'].includes(code)) return 'PROVIDER_DNS_FAILURE';
    if (['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) return 'PROVIDER_CONNECTION_LOST';
    if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) return 'PROVIDER_TCP_FAILURE';
    if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code)) return 'PROVIDER_NETWORK_TIMEOUT';
    if (['ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_SSL_WRONG_VERSION_NUMBER'].includes(code)) return 'PROVIDER_TLS_FAILURE';
    current = value.cause;
  }
  return 'PROVIDER_NETWORK_UNKNOWN';
}
