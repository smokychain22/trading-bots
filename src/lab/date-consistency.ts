import { z } from 'zod';

/** Same date-only calendar arithmetic as normalized ingestion. UTC is explicit
 * here because the research input has a timestamp, not an asOfDate field.
 * This does not redefine Production management/session DTE policy. */
export function researchDteConsistent(input: { expiration: string; dte: number }, decisionTimestamp: string): boolean {
  if (!z.string().date().safeParse(input.expiration).success
    || !z.string().datetime({ offset: true }).safeParse(decisionTimestamp).success
    || !Number.isSafeInteger(input.dte) || input.dte < 0) return false;
  const asOfDate = new Date(decisionTimestamp).toISOString().slice(0, 10);
  const expected = (Date.parse(`${input.expiration}T00:00:00Z`) - Date.parse(`${asOfDate}T00:00:00Z`)) / 86_400_000;
  return expected === input.dte;
}
