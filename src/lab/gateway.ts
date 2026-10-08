import { randomUUID } from 'node:crypto';
import { fetchMasterAccountEvidence, fetchPositions, fetchOpenOrders, fetchMarketClock,
  fetchOptionContracts, fetchOptionSnapshots, type AlpacaProviderConfig,
  type FetchOptionContractsParams, type FetchOptionSnapshotsParams } from '../theta/alpaca-provider.js';
import { createGetOnlyFetch } from '../theta/read-only-fetch.js';
import { canonicalThetaStrategyRegistry } from '../theta/strategy-package.js';
import type { DotLabStore } from './store.js';
import type { DotCanonicalLedgerReader } from './ledger-import.js';

/** Reuses THETA's canonical readers. No mutation-capable broker object is constructed. */
export class DotLabGateway {
  private readonly provider: AlpacaProviderConfig;
  constructor(config: AlpacaProviderConfig, readonly store: DotLabStore, private readonly now = () => new Date().toISOString(),
    private readonly ledgerReader?: DotCanonicalLedgerReader) {
    if (config.tradingApiBase !== 'https://paper-api.alpaca.markets' || config.marketDataApiBase !== 'https://data.alpaca.markets') throw new Error('DOT_PROVIDER_HOST_FORBIDDEN');
    const read = createGetOnlyFetch(config.fetchImpl ?? fetch, 'DOT_BROKER_MUTATION_FORBIDDEN');
    this.provider = { ...config, fetchImpl: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (!['https://paper-api.alpaca.markets', 'https://data.alpaca.markets'].includes(url.origin)
        || url.username || url.password) throw new Error('DOT_PROVIDER_HOST_FORBIDDEN');
      return read(input, { ...init, redirect: 'error' });
    } };
  }
  async ledger() {
    if (!this.ledgerReader) throw new Error('DOT_CANONICAL_LEDGER_NOT_CONNECTED');
    if (this.ledgerReader.identity.providerAccountId !== this.store.identity.providerAccountId
      || this.ledgerReader.identity.executionAccountId !== this.store.identity.executionAccountId
      || this.ledgerReader.identity.workspaceId !== this.store.identity.workspaceId) throw new Error('DOT_LEDGER_ACCOUNT_BINDING_INVALID');
    await this.account();
    const receipt = await this.ledgerReader.read(this.now());
    await this.account();
    this.store.saveObservation({ providerAccountId: this.store.identity.providerAccountId,
      observationId: randomUUID(), receivedAt: this.now(), data: receipt });
    return receipt;
  }
  async account() {
    const evidence = await fetchMasterAccountEvidence(this.provider, this.now);
    if (evidence.providerAccountId !== this.store.identity.providerAccountId) throw new Error('DOT_BROKER_ACCOUNT_MISMATCH');
    return evidence;
  }
  async observe() {
    const account = await this.account();
    const positions = await fetchPositions(this.provider, this.now());
    const orders = await fetchOpenOrders(this.provider, this.now(), { maxPages: 2 });
    const clock = await fetchMarketClock(this.provider, this.now());
    await this.account(); // Fail closed if the provider's identity changes during a multi-read observation.
    const receipt = { providerAccountId: account.providerAccountId, observationId: randomUUID(), receivedAt: this.now(),
      data: { account: account.snapshot, capitalDecimals: account.capitalDecimals, positions, orders, clock,
        truthClass: 'BROKER_ACTUAL', brokerAuthority: false, executionEnabled: false } };
    const hash = this.store.saveObservation(receipt);
    return { ...receipt, hash };
  }
  async contracts(params: FetchOptionContractsParams) { await this.account(); return fetchOptionContracts(this.provider, params); }
  async market(params: FetchOptionSnapshotsParams) {
    await this.account();
    const result = await fetchOptionSnapshots(this.provider, params);
    // Raw observations retain feed and freshness facts. They never self-certify as executable BBO.
    return { ...result, snapshots: Object.fromEntries(result.snapshots), receivedAt: this.now(), feed: params.feed,
      qualification: 'REQUIRES_CANONICAL_QUOTE_QUALIFICATION', brokerAuthority: false };
  }
  strategies() { return [...canonicalThetaStrategyRegistry.values()]; }
}
