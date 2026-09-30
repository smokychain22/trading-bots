import { readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

// Shell globstar is disabled by default on the Linux CI shell. Enumerate in
// Node so tests at the root and in nested directories run on every platform.
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : entry.isFile() && entry.name.endsWith('.test.ts') ? [path] : [];
  });
}
const files = collect('tests').map(path => path.replaceAll('\\', '/')).sort();
if (files.length === 0) throw new Error('NODE_TEST_DISCOVERY_EMPTY');
const args = process.argv.slice(2);
if (args.includes('--list')) {
  process.stdout.write(JSON.stringify(files) + '\n');
} else {
  const evidence = args.find(arg => arg.startsWith('--evidence='))?.slice('--evidence='.length);
  const reporters = evidence ? ['--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=./tools/theta-test-evidence-reporter.mjs', `--test-reporter-destination=${evidence}`] : [];
  if (evidence) mkdirSync(dirname(evidence), { recursive: true });
  process.stdout.write(`NODE_TEST_FILES_DISCOVERED=${files.length}\n`);
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...reporters, ...files], {
    stdio: 'inherit', windowsHide: true,
  });
  process.exitCode = result.status ?? 1;
}
