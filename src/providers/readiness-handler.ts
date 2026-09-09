import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertProviderConfiguration, loadEnvironment } from '../config/environment.js';
import { checkAlpaca, checkOptionomics, type CheckResult } from './readiness.js';

export const matchesOperatorToken = (header: string, expected: string): boolean => {
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const received = Buffer.from(header.slice(prefix.length));
  const expectedBuffer = Buffer.from(expected);
  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
};

const configurationFailure = (provider: CheckResult['provider'], error: unknown): CheckResult => ({
  provider,
  capability: `${provider.toLowerCase()}.configuration`,
  operationAlias: `${provider.toLowerCase()}.configuration`,
  state: 'INVALID',
  httpStatus: null,
  observedAt: new Date().toISOString(),
  provenance: { credentialValuesLogged: false },
  details: { configurationError: error instanceof Error ? error.message : 'UnknownError' }
});

export default async function providerReadinessHandler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.statusCode = 405;
    response.setHeader('Allow', 'POST');
    response.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }

  const operatorToken = process.env.THETA_READINESS_TOKEN ?? '';
  if (operatorToken.length < 32 || !matchesOperatorToken(request.headers.authorization ?? '', operatorToken)) {
    response.statusCode = 401;
    response.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  const environment = loadEnvironment();
  const results: CheckResult[] = [];
  try {
    assertProviderConfiguration(environment, 'ALPACA');
    results.push(...await checkAlpaca(environment));
  } catch (error) {
    results.push(configurationFailure('ALPACA', error));
  }
  try {
    assertProviderConfiguration(environment, 'OPTIONOMICS');
    results.push(...await checkOptionomics(environment));
  } catch (error) {
    results.push(configurationFailure('OPTIONOMICS', error));
  }

  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.statusCode = results.every((result) => result.state === 'GOOD') ? 200 : 207;
  response.end(JSON.stringify({ trading: 'disabled', orderSubmission: false, results }));
}
