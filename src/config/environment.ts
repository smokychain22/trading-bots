import { z } from 'zod';

const optionalUrl = z.string().url().optional();

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: optionalUrl,
  REDIS_URL: optionalUrl,
  ALPACA_API_KEY: z.string().min(1).optional(),
  ALPACA_SECRET_KEY: z.string().min(1).optional(),
  ALPACA_BASE_URL: z.string().min(1).optional(),
  OPTIONOMICS_API_KEY: z.string().min(1).optional(),
  OPTIONOMICS_EMAIL: z.string().min(1).optional(),
  VERCEL_PROJECT_ID: z.string().min(1).optional(),
  VERCEL_ORG_ID: z.string().min(1).optional(),
  VERCEL_TOKEN: z.string().min(1).optional()
});

export type Environment = z.infer<typeof environmentSchema>;
export type ProviderName = 'ALPACA' | 'OPTIONOMICS';

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

  if (!environment.ALPACA_BASE_URL?.startsWith('https://paper-api.alpaca.markets')) {
    throw new Error('ALPACA_BASE_URL must point to the Alpaca paper API. Live trading is not enabled.');
  }
};
