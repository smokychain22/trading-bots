import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AlpacaProviderError } from '../theta/alpaca-provider.js';
import { validateDotProposal } from './contracts.js';
import type { DotLabGateway } from './gateway.js';
import { dotMcpReply } from './mcp.js';
import { exportDotPrivateObservation } from './private-export.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
});
const marketQuery = z.object({
  underlying: z.string().regex(/^[A-Z][A-Z0-9.]{0,9}$/),
  from: day, to: day, type: z.enum(['put', 'call']),
  feed: z.enum(['opra', 'indicative']).default('indicative'),
}).strict().refine(value => value.from <= value.to && Date.parse(value.to) - Date.parse(value.from) <= 90 * 86400000);

export interface DotLabTokens { readonly reader: string; readonly proposer: string }
export function createDotLabApp(gateway: DotLabGateway, tokens: DotLabTokens) {
  if (![tokens.reader, tokens.proposer].every(token => /^[a-f0-9]{64}$/.test(token)) || tokens.reader === tokens.proposer) throw new Error('DOT_ACCESS_TOKEN_INVALID');
  const digest = (token: string) => createHash('sha256').update(token).digest();
  const reader = digest(tokens.reader), proposer = digest(tokens.proposer);
  const app = express();
  app.disable('x-powered-by');
  const rates = new Map<string, { since: number; count: number }>();
  app.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Deployed access must terminate trusted HTTPS. No proxy headers are trusted by default.
    if (!request.secure && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) {
      response.status(403).json({ error: 'DOT_HTTPS_REQUIRED' }); return;
    }
    const match = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '');
    if (!match?.[1]) { response.status(401).json({ error: 'DOT_AUTH_REQUIRED' }); return; }
    const hash = digest(match[1]);
    const scope = timingSafeEqual(hash, proposer) ? 'PROPOSER' : timingSafeEqual(hash, reader) ? 'READER' : null;
    if (scope === null) { response.status(401).json({ error: 'DOT_AUTH_REQUIRED' }); return; }
    if (request.method !== 'GET' && !(request.method === 'POST' && request.path === '/v1/proposals' && scope === 'PROPOSER')
      && !(request.method === 'POST' && request.path === '/mcp')) {
      response.status(403).json({ error: 'DOT_OPERATION_FORBIDDEN' }); return;
    }
    const now = Date.now();
    const rate = rates.get(scope);
    const current = !rate || now - rate.since >= 60_000 ? { since: now, count: 0 } : rate;
    if (++current.count > 30) { response.status(429).json({ error: 'DOT_RATE_LIMIT' }); return; }
    rates.set(scope, current);
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  // Stateless JSON Streamable-HTTP core. Local bearer auth is NOT claimed as a completed ChatGPT OAuth connection.
  app.post('/mcp', async (request, response) => {
    const reply = await dotMcpReply(gateway, request.body);
    if (reply === null) response.sendStatus(202);
    else response.json(reply);
  });
  app.get('/v1/status', (_request, response) => response.json({ lab: 'DOT_STRATEGY_LAB', environment: 'PAPER',
    accountSuffix: gateway.store.identity.accountNumber.slice(-4), workerEnabled: false, executionEnabled: false,
    paperExperimentState: 'OWNER_AUTHORIZATION_AND_CANONICAL_RELEASE_REQUIRED' }));
  app.get('/v1/observation', async (_request, response) => response.json(await gateway.observe()));
  app.get('/v1/account', async (_request, response) => response.json((await gateway.account()).snapshot));
  app.get('/v1/strategies', (_request, response) => response.json({ strategies: gateway.strategies(), source: 'THETA_CANONICAL_REGISTRY',
    qualification: 'SOURCE_VERSION_NOT_DEPLOYED_WORKER_PROOF' }));
  app.get('/v1/contracts', async (request, response) => {
    const query = marketQuery.parse(request.query);
    response.json(await gateway.contracts({ underlyingSymbol: query.underlying, expirationDateGte: query.from,
      expirationDateLte: query.to, optionType: query.type, limit: 100, maxPages: 2, showDeliverables: true }));
  });
  app.get('/v1/market', async (request, response) => {
    const query = marketQuery.parse(request.query);
    response.json(await gateway.market({ underlyingSymbol: query.underlying, expirationDateGte: query.from,
      expirationDateLte: query.to, optionType: query.type, feed: query.feed, limit: 100, maxPages: 2 }));
  });
  app.get('/v1/proposals', (_request, response) => response.json(gateway.store.list('PROPOSAL')));
  app.post('/v1/proposals', (request, response) => {
    const proposal = validateDotProposal(request.body);
    const storageHash = gateway.store.saveProposal(proposal, new Date().toISOString());
    response.status(201).json({ proposal, storageHash, activation: 'NOT_AUTHORIZED', brokerAuthority: false });
  });
  app.get('/v1/receipts', (_request, response) => response.json(gateway.store.list('OBSERVATION')));
  app.get('/v1/private-export', (_request, response) => response.json(exportDotPrivateObservation(gateway.store)));
  app.get('/v1/experiments', (_request, response) => response.json(gateway.store.list('EXPERIMENT')));
  app.get('/v1/performance', (_request, response) => response.json({
    state: 'CANONICAL_LAB_LIFECYCLE_IMPORT_NOT_CONNECTED', afterCostPnl: null, profitability: 'EMPIRICALLY_UNPROVEN',
    reason: 'Broker equity and position marks cannot substitute for a resolved, fee-qualified whole-chain ledger.',
  }));
  app.use((_request, response) => response.status(404).json({ error: 'DOT_ROUTE_NOT_FOUND' }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    void _next; // Express recognizes error middleware by its four-argument arity.
    const code = error instanceof AlpacaProviderError ? `DOT_PROVIDER_${error.errorClass}`
      : error instanceof z.ZodError ? 'DOT_INPUT_INVALID'
      : error instanceof Error && /^DOT_[A-Z_]+$/.test(error.message) ? error.message : 'DOT_INTERNAL_FAILURE';
    response.status(code === 'DOT_INPUT_INVALID' ? 400 : code.startsWith('DOT_PROVIDER_') ? 502 : 409).json({ error: code });
  });
  return app;
}
