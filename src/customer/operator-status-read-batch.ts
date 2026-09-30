/** Coalesce only overlapping identical read requests. No completed result is
 * cached, so a later operator request always observes fresh database truth. */
export function createSingleFlightRead<T>() {
  const pending = new Map<string, Promise<T>>();
  return (identity: string, read: () => Promise<T>): Promise<T> => {
    const existing = pending.get(identity);
    if (existing) return existing;
    const result = Promise.resolve().then(read);
    pending.set(identity, result);
    void result.then(() => pending.delete(identity), () => pending.delete(identity));
    return result;
  };
}

/** Helpers own and close their temporary pools. Running them sequentially
 * bounds this status batch to one physical connection instead of seven. */
export async function readSequentially<T extends readonly unknown[]>(
  readers: { readonly [K in keyof T]: () => Promise<T[K]> },
): Promise<T> {
  const result: unknown[] = [];
  for (const read of readers) result.push(await read());
  return result as unknown as T;
}
