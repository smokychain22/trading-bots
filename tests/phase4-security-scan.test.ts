// Phase 4: the public-repository secret/privacy scanner. Every rule family is proven to FIRE on a realistic leak and to STAY QUIET on the
// fixtures the repository legitimately contains; the tracked tree itself must be clean; and the scanner never echoes matched text.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error plain ESM tool without type declarations
import { scanContent, scanRepository } from '../tools/security-scan.mjs';

const scan = (path: string, content: string, environment: Record<string, string> = {}): string[] => scanContent(path, content, environment);
// leaks are assembled at run time so this test file itself contains no literal that matches a rule
const alpacaKey = 'P' + 'K' + 'ABCDEFGHIJKLMNOPQRST';
const longSecret = 'a1B2c3D4e5F6g7H8' + 'i9J0k1L2m3N4o5P6';
const dbUrl = (password: string, host: string) => `postgres://appuser:${password}@${host}/prod`;

test('each rule family fires on a realistic leak', () => {
  assert.ok(scan('src/x.ts', `const key = '${alpacaKey}';`).includes('Alpaca key shape'));
  assert.ok(scan('src/x.ts', `const url = '${dbUrl('Zx9Qw8Er7Ty6Ui5Op4', 'db-prod.aivencloud.com:12345')}';`).includes('Database URL with a real-looking password'));
  assert.ok(scan('src/x.ts', `headers: { Authorization: 'Bearer ${longSecret}${longSecret}' }`).includes('Bearer token'));
  assert.ok(scan('src/x.ts', `const api_key = "${longSecret}${longSecret}";`).includes('Secret assigned a long literal'));
  assert.ok(scan('notes.md', 'contact: ' + 'someone' + '@' + 'gmail' + '.com').includes('Personal email address'));
  assert.ok(scan('docs/a.md', 'run C:\\' + 'Users\\' + 'alice\\project').includes('Local user-home path'));
  assert.ok(scan('docs/a.json', '{"p":"/' + 'Users/' + 'alice/work"}').includes('Local user-home path'));
  assert.ok(scan('k.pem', '-----BEGIN ' + 'OPENSSH ' + 'PRIVATE KEY-----').includes('Private key'));
  assert.ok(scan('k.pem', '-----BEGIN ' + 'PRIVATE KEY-----').includes('Private key'));
  assert.ok(scan('src/x.ts', 'const v = process.env.ALPACA_API_KEY; // ' + 'x', { ALPACA_API_KEY: longSecret + longSecret }).length === 0, 'an unset secret value is not a finding');
  assert.ok(scan('src/x.ts', 'leaked ' + longSecret + longSecret, { ALPACA_API_KEY: longSecret + longSecret }).some((finding: string) => finding.startsWith('configured sensitive value')));
});

test('legitimate fixtures stay quiet: labelled fake keys, local/CI database URLs, placeholder passwords, example emails, placeholder paths', () => {
  assert.deepEqual(scan('tests/x.ts', `const REALISTIC_FAKE_ALPACA_KEY = '${alpacaKey}';`), []);
  assert.deepEqual(scan('tests/x.ts', `postgresql://trading_bots:ci-only-password@127.0.0.1:5432/trading_bots`), []);
  assert.deepEqual(scan('tests/x.ts', `connectionString: '${dbUrl('placeholder-password-12345', 'service.example.com')}'`), []);
  assert.deepEqual(scan('tests/x.ts', `const u = '${dbUrl('Zx9Qw8Er7Ty6Ui5Op4', 'db.invalid')}';`), []);
  assert.deepEqual(scan('tests/x.ts', `const u = '${dbUrl('Zx9Qw8Er7Ty6Ui5Op4', 'localhost:5432')}';`), []);
  assert.deepEqual(scan('tests/x.ts', 'headers: { Authorization: `Bearer ${token}` }'), []);
  assert.deepEqual(scan('tests/x.ts', `const token = 'synthetic-${longSecret}${longSecret}'; // fake`), []);
  assert.deepEqual(scan('docs/a.md', 'mail info@' + 'example.com and C:\\' + 'Users\\<user>\\repo'), []);
  assert.deepEqual(scan('src/x.ts', 'const ordinary = "no secrets here"; // PKG-1234 is not a key'), []);
});

test('findings name the file and the rule only: matched text is never printed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'theta-scan-'));
  try {
    mkdirSync(join(directory, 'evidence'));
    writeFileSync(join(directory, 'evidence', 'run.jsonl'), JSON.stringify({ note: `leaked ${alpacaKey}` }));
    const output = execFileSync(process.execPath, [join(process.cwd(), 'tools/security-scan.mjs'), `--extra=${join(directory, 'evidence').replaceAll('\\', '/')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    void output;
    assert.fail('the scan must exit non-zero when a generated artifact contains a key shape');
  } catch (error) {
    const failure = error as { status?: number; stderr?: Buffer | string; stdout?: Buffer | string };
    assert.equal(failure.status, 1);
    const text = `${failure.stderr ?? ''}${failure.stdout ?? ''}`;
    assert.match(text, /run\.jsonl: Alpaca key shape/);
    assert.equal(text.includes(alpacaKey), false, 'the matched secret must never be echoed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the tracked tree is clean under every rule (no secret, personal email or local user-home path in public files)', () => {
  const result = scanRepository([], {});
  assert.deepEqual(result.findings, [], `findings: ${result.findings.map(([path, rule]: [string, string]) => `${path}: ${rule}`).join('; ')}`);
  assert.ok(result.scanned > 1500, 'the scan must actually cover the repository');
});

test('.gitignore keeps secrets, tokens, backups and generated evidence out of the repository', async () => {
  const { readFileSync } = await import('node:fs');
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split(/\r?\n/);
  for (const pattern of ['.env*', '*.pem', '*.key', '*.token', 'worker.token', '.theta-local-worker/', '*.backup', '*.dump', '*.bak', 'backups/', '.ci-test-evidence/', '*.safetensors', '*.pt', '*.joblib']) {
    assert.ok(ignore.includes(pattern), `${pattern} must be ignored`);
  }
});
