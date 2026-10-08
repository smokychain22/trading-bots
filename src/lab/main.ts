import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { parse } from 'dotenv';
import { z } from 'zod';
import { dotLabIdentitySchema } from './contracts.js';
import { DotLabStore } from './store.js';
import { DotLabGateway } from './gateway.js';
import { createDotLabApp } from './http.js';
import { runDotStdio } from './stdio.js';

/** Explicit private files only. Never inherit THETA's process environment or database URL. */
export function startDotLab(args: readonly string[]) {
  if (args.includes('--verify-only') && args.includes('--stdio')) throw new Error('DOT_RUN_MODE_CONFLICT');
  const readArg = (key: string) => {
    const matches = args.filter(arg => arg.startsWith(`--${key}=`));
    if (matches.length !== 1) throw new Error('DOT_EXPLICIT_CONFIGURATION_REQUIRED');
    return matches[0]?.slice(key.length + 3) as string;
  };
  const privatePath = (path: string, existing: boolean) => {
    if (!isAbsolute(path)) throw new Error('DOT_PRIVATE_ABSOLUTE_PATH_REQUIRED');
    const canonical = existing || existsSync(path) ? realpathSync(path) : resolve(realpathSync(dirname(path)), path.split(/[\\/]/).at(-1) as string);
    for (const root of [realpathSync(process.cwd()), resolve(dirname(fileURLToPath(import.meta.url)), '../..')]) {
      const rel = relative(root, canonical);
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('DOT_PRIVATE_PATH_INSIDE_REPOSITORY');
    }
    return canonical;
  };
  const credentials = parse(readFileSync(privatePath(readArg('credentials'), true)));
  const privateConfig = z.object({ ALPACA_API_KEY: z.string().min(1), ALPACA_SECRET_KEY: z.string().min(1),
    ALPACA_BASE_URL: z.literal('https://paper-api.alpaca.markets') }).parse(credentials);
  const identity = dotLabIdentitySchema.parse(JSON.parse(readFileSync(privatePath(readArg('identity'), true), 'utf8')));
  const tokens = z.object({ reader: z.string().regex(/^[a-f0-9]{64}$/), proposer: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
    .refine(value => value.reader !== value.proposer)
    .parse(JSON.parse(readFileSync(privatePath(readArg('tokens'), true), 'utf8')));
  const store = new DotLabStore(privatePath(readArg('state'), false), identity);
  const gateway = new DotLabGateway({ tradingApiBase: privateConfig.ALPACA_BASE_URL, marketDataApiBase: 'https://data.alpaca.markets',
    apiKey: privateConfig.ALPACA_API_KEY, apiSecret: privateConfig.ALPACA_SECRET_KEY }, store);
  if (args.includes('--verify-only')) return gateway.observe().finally(() => store.close());
  if (args.includes('--stdio')) return runDotStdio(gateway, process.stdin, process.stdout).finally(() => store.close());
  let port: number;
  try { port = Number(readArg('port')); } catch (error) { store.close(); throw error; }
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) { store.close(); throw new Error('DOT_PORT_INVALID'); }
  const app = createDotLabApp(gateway, tokens);
  const server = app.listen(port, '127.0.0.1');
  let closed = false;
  const closeStore = () => { if (!closed) { closed = true; store.close(); } };
  server.once('close', closeStore);
  server.once('error', closeStore);
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const operation = startDotLab(process.argv.slice(2));
    if (operation instanceof Promise) await operation;
    else await once(operation, 'listening');
    if (!process.argv.includes('--stdio')) process.stdout.write('DOT_LAB_STARTED_OR_VERIFIED_EXECUTION_DISABLED\n');
  } catch {
    process.stderr.write('DOT_LAB_CONFIGURATION_OR_VERIFICATION_FAILED\n');
    process.exitCode = 1;
  }
}
