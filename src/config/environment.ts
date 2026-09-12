import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { z } from 'zod';

const optionalUrl = z.string().url().optional();
const booleanFlag = (defaultValue: 'true' | 'false') => z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.enum(['true', 'false']).default(defaultValue),
).transform((value) => value === 'true');
const safeFlag = booleanFlag('false');

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: optionalUrl,
  DATABASE_MIGRATION_URL: optionalUrl,
  REDIS_URL: optionalUrl,
  ALPACA_API_KEY: z.string().min(1).optional(),
  ALPACA_SECRET_KEY: z.string().min(1).optional(),
  ALPACA_BASE_URL: z.string().min(1).optional(),
  OPTIONOMICS_API_KEY: z.string().min(1).optional(),
  OPTIONOMICS_EMAIL: z.string().min(1).optional(),
  ALPACA_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  ALPACA_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  ALPACA_OAUTH_REDIRECT_URI: optionalUrl,
  PAPER_COPY_TOKEN_KEY_REF: z.string().min(1).optional(),
  PAPER_COPY_TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  PRIVATE_PAPER_API_KEY_BETA_ENABLED: safeFlag,
  MASTER_PAPER_EXECUTION_ENABLED: safeFlag,
  FOLLOWER_PAPER_EXECUTION_ENABLED: safeFlag,
  PAPER_PAUSE_NEW_ORDERS: booleanFlag('true'),
  THETA_AUTONOMOUS_WORKER_ENABLED: safeFlag,
  THETA_RUNTIME_MODE: z.literal('THETA_SHADOW_ONLY').default('THETA_SHADOW_ONLY'),
  THETA_WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  THETA_WORKER_INTERVAL_MS: z.coerce.number().int().min(10_000).max(900_000).default(60_000),
  THETA_PYTHON_EXECUTABLE: z.string().min(1).default('python3'),
  CRON_SECRET: z.string().min(32).optional(),
  VERCEL_PROJECT_ID: z.string().min(1).optional(),
  VERCEL_ORG_ID: z.string().min(1).optional(),
  VERCEL_TOKEN: z.string().min(1).optional()
});

export type Environment = z.infer<typeof environmentSchema>;
export type ProviderName = 'ALPACA' | 'OPTIONOMICS';

export const environmentPrecedence = [
  'explicit dotenv file parsed by dotenv, excluding the exact Vercel redaction sentinel',
  'process environment fallback',
  'schema defaults'
] as const;

const VERCEL_REDACTED_VALUE = '[SENSITIVE]';

// No .env variant is loaded implicitly. Callers must name the intended file.
// Explicit file values override stale shell/process values for deterministic checks.
export const loadEnvironmentFile = (
  filePath: string,
  processSource: NodeJS.ProcessEnv = process.env
): Environment => {
  // Vercel can preserve a key name while withholding a sensitive value in
  // a downloaded dotenv file. That marker is metadata, not configuration.
  // Ignore only the exact marker. Never strip quotes or mutate arbitrary
  // secret values here. dotenv already owns quote parsing.
  const fileSource = Object.fromEntries(
    Object.entries(parse(readFileSync(filePath))).filter(([, value]) => value !== VERCEL_REDACTED_VALUE),
  );
  const safeProcessSource = Object.fromEntries(
    Object.entries(processSource).filter(([, value]) => value !== VERCEL_REDACTED_VALUE),
  );
  return environmentSchema.parse({ ...safeProcessSource, ...fileSource });
};

export const loadEnvironment = (source: NodeJS.ProcessEnv = process.env): Environment =>
  environmentSchema.parse(source);

export const missingProviderVariables = (
  environment: Environment,
  provider: ProviderName
): readonly string[] => {
  const variables = provider === 'ALPACA'
    ? ['ALPACA_API_KEY', 'ALPACA_SECRET_KEY', 'ALPACA_BASE_URL'] as const
    : ['OPTIONOMICS_API_KEY', 'OPTIONOMICS_EMAIL'] as const;

  return variables.filter((variable) => !environment[variable]);
};

export const assertProviderConfiguration = (
  environment: Environment,
  provider: ProviderName
): void => {
  const missing = missingProviderVariables(environment, provider);
  if (missing.length > 0) {
    throw new Error(`${provider} configuration is incomplete. Missing variable names: ${missing.join(', ')}`);
  }
  if (provider === 'OPTIONOMICS' && !z.string().email().safeParse(environment.OPTIONOMICS_EMAIL).success) {
    throw new Error('OPTIONOMICS_EMAIL must be a valid email address.');
  }
};

export const assertRuntimeConfiguration = (environment: Environment): void => {
  assertProviderConfiguration(environment, 'ALPACA');
  assertProviderConfiguration(environment, 'OPTIONOMICS');

  let alpacaUrl: URL;
  try {
    alpacaUrl = new URL(environment.ALPACA_BASE_URL ?? '');
  } catch {
    throw new Error('ALPACA_BASE_URL must point to the Alpaca paper API. Live trading is not enabled.');
  }
  if (
    alpacaUrl.protocol !== 'https:' ||
    alpacaUrl.hostname !== 'paper-api.alpaca.markets' ||
    alpacaUrl.port !== '' ||
    !['', '/'].includes(alpacaUrl.pathname) ||
    alpacaUrl.search !== '' ||
    alpacaUrl.hash !== ''
  ) {
    throw new Error('ALPACA_BASE_URL must point to the Alpaca paper API. Live trading is not enabled.');
  }
};

export const assertAutonomousWorkerConfiguration = (environment: Environment): void => {
  if (!environment.THETA_AUTONOMOUS_WORKER_ENABLED) throw new Error('THETA_AUTONOMOUS_WORKER_DISABLED');
  if (!environment.DATABASE_URL) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
  if (!environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY) throw new Error('PAPER_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED');
  if (!environment.PAPER_PAUSE_NEW_ORDERS || environment.MASTER_PAPER_EXECUTION_ENABLED || environment.FOLLOWER_PAPER_EXECUTION_ENABLED) {
    throw new Error('FIRST_PAPER_ORDER_BOUNDARY_NOT_LOCKED');
  }
  if (environment.THETA_RUNTIME_MODE !== 'THETA_SHADOW_ONLY') throw new Error('THETA_SHADOW_ONLY_REQUIRED');
};
