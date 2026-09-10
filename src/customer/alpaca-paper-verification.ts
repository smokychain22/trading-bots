import { z } from "zod";
import type { AlpacaPaperAuthentication } from "../execution/broker.js";
import { AlpacaPaperBrokerAdapter, AlpacaPaperBrokerError } from "../execution/broker.js";

export const ALPACA_PAPER_BASE_URL = "https://paper-api.alpaca.markets";

const accountSchema = z.object({
  id: z.string().min(4),
  status: z.string().nullable().optional(),
  equity: z.coerce.number().finite().nullable().optional(),
  cash: z.coerce.number().finite().nullable().optional(),
  buying_power: z.coerce.number().finite().nullable().optional(),
  options_buying_power: z.coerce.number().finite().nullable().optional(),
  options_approved_level: z.number().int().nullable().optional(),
  options_trading_level: z.number().int().nullable().optional(),
  trading_blocked: z.boolean().optional(),
  account_blocked: z.boolean().optional(),
  transfers_blocked: z.boolean().optional(),
}).passthrough();
const clockSchema = z.object({ is_open: z.boolean(), timestamp: z.string().optional() }).passthrough();

export type FollowerVerification = {
  readonly account: z.infer<typeof accountSchema>;
  readonly positions: readonly unknown[];
  readonly openOrders: readonly unknown[];
  readonly marketOpen: boolean;
  readonly ready: boolean;
  readonly reason: string | null;
};

export async function verifyAlpacaPaperAccount(
  authentication: AlpacaPaperAuthentication,
  fetchImpl: typeof fetch = fetch,
  baseUrl = ALPACA_PAPER_BASE_URL,
): Promise<FollowerVerification> {
  if (baseUrl !== ALPACA_PAPER_BASE_URL) throw new Error("ALPACA_PAPER_HOST_REJECTED");
  const adapter = new AlpacaPaperBrokerAdapter({ baseUrl, authentication, fetchImpl });
  const clockRequest = async () => {
    const headers: HeadersInit = authentication.kind === "FOLLOWER_OAUTH"
      ? { Authorization: `Bearer ${authentication.accessToken}` }
      : { "APCA-API-KEY-ID": authentication.apiKey, "APCA-API-SECRET-KEY": authentication.apiSecret };
    const response = await fetchImpl(`${ALPACA_PAPER_BASE_URL}/v2/clock`, { headers, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new AlpacaPaperBrokerError(response.status === 401 ? "INVALID_AUTH" : "BROKER_REJECTED", response.status, `Alpaca PAPER /v2/clock returned HTTP ${response.status}.`);
    return clockSchema.parse(await response.json());
  };
  const [rawAccount, positions, openOrders, clock] = await Promise.all([
    adapter.getAccount(), adapter.getPositions(), adapter.getOrders("open"), clockRequest(),
  ]);
  const account = accountSchema.parse(rawAccount);
  const optionsLevel = account.options_trading_level ?? account.options_approved_level ?? 0;
  const active = account.status === "ACTIVE";
  const blocked = account.trading_blocked === true || account.account_blocked === true;
  const accountFactsAvailable = [account.equity, account.cash, account.buying_power, account.options_buying_power]
    .every((value) => typeof value === "number");
  const optionsFactsAvailable = account.options_trading_level != null || account.options_approved_level != null;
  const ready = active && !blocked && accountFactsAvailable && optionsFactsAvailable && optionsLevel >= 1;
  return {
    account,
    positions,
    openOrders,
    marketOpen: clock.is_open,
    ready,
    reason: !active
      ? "Your Alpaca Paper account is not active."
      : blocked
        ? "Your Alpaca Paper account is restricted."
        : !accountFactsAvailable || !optionsFactsAvailable
          ? "Required Alpaca Paper account or options information is unavailable."
        : optionsLevel < 1
          ? "Your paper account needs options trading enabled before it can copy THETA."
          : null,
  };
}
