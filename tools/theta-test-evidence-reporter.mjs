import { relative } from 'node:path';

// Executed test events, never source markers or inferred global success.
// No error payloads, provider responses or environment values are emitted.
export default async function* report(source) {
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const data = event.data;
    yield JSON.stringify({
      file: typeof data.file === 'string' ? relative(process.cwd(), data.file).replaceAll('\\', '/') : null,
      name: data.name,
      state: data.skip ? 'SKIPPED' : data.todo ? 'TODO' : event.type === 'test:pass' ? 'PASS' : 'FAIL',
      durationMs: data.details?.duration_ms ?? null,
      line: data.line ?? null,
    }) + '\n';
  }
}
