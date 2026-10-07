/**
 * Operational tools never pick a database target implicitly. `.env.local` points at a NON-Production development database, and a tool that
 * silently defaulted to it has twice validated or written the wrong database (post-migration checks, strategy authority, the emergency lock).
 * Every caller states its target: `--environment-file=.theta-local-worker/production.env` for Production, `--environment-file=.env.local`
 * for the development database, or `--environment-file=process` where a tool supports the process-only mode.
 */
export function explicitEnvironmentFile(argv: readonly string[] = process.argv): string {
  const value = argv.find((argument) => argument.startsWith('--environment-file='))?.slice('--environment-file='.length);
  if (value === undefined || value.trim() === '') {
    throw new Error('TOOL_REQUIRES_EXPLICIT_ENVIRONMENT_FILE: pass --environment-file=<file> '
      + '(.theta-local-worker/production.env = Production, .env.local = non-Production development database)');
  }
  return value;
}
