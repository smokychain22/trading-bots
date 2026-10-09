/** Defense in depth for diagnostic text and structured receipts. Callers must
 * still prefer allowlisted error codes over serializing arbitrary inputs. */
const sensitiveKey = (key: string): boolean => /password|passwd|secret|token|apikey|authorization|cookie|databaseurl|dsn|privatekey/
  .test(key.replace(/[^a-z0-9]/gi, '').toLowerCase());
const assignedSecret = /\b(password|passwd|secret|token|api[_-]?key|authorization|cookie|database[_-]?url|aiven[_-]?database[_-]?url|dsn)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;
const databaseUrl = /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi;
const authenticatedUrl = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@[^\s"'<>]+/gi;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/-]+/gi;

export function redactDiagnosticText(value: string): string {
  return value.replace(databaseUrl, '[REDACTED_DATABASE_URL]')
    .replace(authenticatedUrl, '[REDACTED_AUTHENTICATED_URL]')
    .replace(bearer, 'Bearer [REDACTED]')
    .replace(assignedSecret, '$1=[REDACTED]');
}

/** Redact by field name first, then scrub text. Unknown object types are not
 * stringified because their custom toString/JSON methods may reveal secrets. */
export function redactDiagnosticValue(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (typeof item === 'string') return redactDiagnosticText(item);
    if (typeof item === 'function' || typeof item === 'symbol') return '[UNSUPPORTED_VALUE]';
    if (item === null || typeof item !== 'object') return item;
    if (depth > 12) return '[MAX_DEPTH]';
    if (seen.has(item)) return '[CIRCULAR]';
    seen.add(item);
    if (item instanceof Error) return {
      name: redactDiagnosticText(item.name), message: redactDiagnosticText(item.message),
      stack: item.stack === undefined ? null : redactDiagnosticText(item.stack),
    };
    if (Array.isArray(item)) return item.map((child) => visit(child, depth + 1));
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) return '[UNSUPPORTED_OBJECT]';
    return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(item))
      .filter(([, descriptor]) => descriptor.enumerable)
      .map(([key, descriptor]) => [key, sensitiveKey(key) ? '[REDACTED]'
        : 'value' in descriptor ? visit(descriptor.value, depth + 1) : '[ACCESSOR_REDACTED]']));
  };
  return visit(value, 0);
}
