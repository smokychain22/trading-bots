const nonempty = (value) => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

export function normalizeAivenConnectionString(value) {
  const url = new URL(value);
  if (url.hostname.endsWith('.aivencloud.com')
    && url.searchParams.get('sslmode') === 'require'
    && !url.searchParams.has('uselibpqcompat')) {
    url.searchParams.set('uselibpqcompat', 'true');
  }
  return url.toString();
}

export function resolveDatabaseConnection(environment, purpose = 'runtime') {
  const authority = nonempty(environment.DATABASE_RUNTIME_AUTHORITY) ?? 'NEON';
  if (!['AIVEN', 'NEON'].includes(authority)) throw new Error('DATABASE_RUNTIME_AUTHORITY_INVALID');

  if (purpose === 'archive') {
    const archive = nonempty(environment.NEON_ARCHIVE_DATABASE_URL);
    if (!archive) throw new Error('NEON_ARCHIVE_DATABASE_NOT_CONFIGURED');
    return { authority: 'NEON_ARCHIVE', connectionString: archive, sourceVariable: 'NEON_ARCHIVE_DATABASE_URL' };
  }

  if (authority === 'AIVEN') {
    const aiven = nonempty(environment.AIVEN_DATABASE_URL);
    if (!aiven) throw new Error('AIVEN_DATABASE_NOT_CONFIGURED');
    return { authority, connectionString: normalizeAivenConnectionString(aiven), sourceVariable: 'AIVEN_DATABASE_URL' };
  }

  const candidates = purpose === 'migration'
    ? [
        ['DATABASE_MIGRATION_URL', environment.DATABASE_MIGRATION_URL],
        ['DATABASE_URL_UNPOOLED', environment.DATABASE_URL_UNPOOLED],
        ['POSTGRES_URL_NON_POOLING', environment.POSTGRES_URL_NON_POOLING],
        ['DATABASE_URL', environment.DATABASE_URL],
      ]
    : [['DATABASE_URL', environment.DATABASE_URL]];
  const selected = candidates.find(([, value]) => nonempty(value));
  if (!selected) throw new Error(purpose === 'migration'
    ? 'DATABASE_MIGRATION_CONNECTION_NOT_CONFIGURED'
    : 'DATABASE_CONNECTION_NOT_CONFIGURED');
  return { authority, connectionString: nonempty(selected[1]), sourceVariable: selected[0] };
}
