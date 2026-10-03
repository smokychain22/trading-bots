// Public-repository secret and privacy scan. Prints paths and rule names only, never matching secret text.
//   node tools/security-scan.mjs                     tracked and non-ignored working files
//   node tools/security-scan.mjs --extra=<dir> ...   additionally scan every file under <dir> (generated artifacts: CI evidence, test output)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Rules are assembled from fragments so this file never contains a literal that would match itself.
const credentialLikeFixture = /fake|synthetic|example|placeholder|sample|dummy|redact|changeme|\bnot[- ]a[- ]real/i;
const harmlessPasswords = new Set(["password", "pass", "secret", "placeholder", "owner", "admin", "user", "changeme", "example", "test", "postgres", "x", "xxx", "token", "unused", "ci-only-password", "pw", "secret-a", "secret-b"]);
const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|wsl-socket|postgres|db)$|\.(?:invalid|test|example|local|internal)$|(?:^|\.)example\./i;

/** @type {Array<{ name: string, pattern: RegExp, lineAllow?: RegExp, scope?: RegExp, accept?: (match: RegExpExecArray) => boolean }>} */
export const rules = [
  { name: "GitHub token", pattern: new RegExp("github" + "_pat_[A-Za-z0-9_]{40,}") },
  { name: "GitHub classic token", pattern: new RegExp("gh" + "[pousr]_[A-Za-z0-9]{30,}") },
  { name: "Vercel token", pattern: new RegExp("vc" + "p_[A-Za-z0-9]{30,}") },
  { name: "Private key", pattern: new RegExp("-----BEGIN [A-Z ]*" + "PRIVATE KEY-----") },
  { name: "AWS access key", pattern: new RegExp("AK" + "IA[A-Z0-9]{16}") },
  { name: "Alpaca key shape", pattern: new RegExp("\\b(?:P" + "K|A" + "K)[A-Z0-9]{18,}\\b"), lineAllow: credentialLikeFixture },
  {
    name: "Database URL with a real-looking password",
    pattern: new RegExp("postgres(?:ql)?://[^:/\\s@\"'`]+:([^@\\s/\"'`]{12,})@([^/\\s:?\"'`]+)", "g"),
    lineAllow: credentialLikeFixture,
    accept: (match) => !localHost.test(match[2] ?? "") && !harmlessPasswords.has((match[1] ?? "").toLowerCase()) && /[A-Za-z]/.test(match[1] ?? "") && /\d/.test(match[1] ?? ""),
  },
  { name: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{24,}/, lineAllow: credentialLikeFixture },
  {
    name: "Secret assigned a long literal",
    pattern: /(?:token|secret|password|api[_-]?key|private[_-]?key)["']?\s*[:=]\s*["'][A-Za-z0-9+/=_-]{32,}["']/i,
    lineAllow: credentialLikeFixture,
  },
  {
    name: "Personal email address",
    pattern: /[A-Za-z0-9._%+-]+@(?:gmail|googlemail|outlook|hotmail|yahoo|icloud|proton(?:mail)?)\.[A-Za-z.]{2,}/i,
    lineAllow: credentialLikeFixture,
  },
  {
    name: "Local user-home path",
    pattern: /[A-Za-z]:\\Users\\(?!you\b|user\b|<)[A-Za-z0-9._-]+\\|\/Users\/(?!you\b|user\b|<)[a-z0-9._-]+\//,
    scope: /^docs\/.*\.(?:md|json)$/,
    lineAllow: credentialLikeFixture,
  },
];

const scannedExtension = /\.(?:[cm]?[jt]sx?|json|jsonl|ndjson|md|ya?ml|sql|toml|html|css|py|ps1|sh|txt|csv|example)$/;
const scannedBasename = /^(?:Dockerfile|Makefile)$/;

const sensitiveNames = [
  "ALPACA_API_KEY", "ALPACA_SECRET_KEY", "OPTIONOMICS_API_KEY", "VERCEL_TOKEN", "THETA_READINESS_TOKEN", "ALPACA_OAUTH_CLIENT_SECRET",
  "PAPER_COPY_TOKEN_ENCRYPTION_KEY", "AIVEN_DATABASE_URL", "DATABASE_URL", "ALPACA_PAPER_API_KEY", "ALPACA_PAPER_SECRET_KEY",
];

/** Rule names found in one file's content (no text, no line numbers beyond what is needed to allow-list fixtures). */
export function scanContent(path, content, environment = process.env) {
  const findings = [];
  const lines = content.split(/\r?\n/);
  for (const rule of rules) {
    if (rule.scope !== undefined && !rule.scope.test(path)) continue;
    const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g";
    const global = new RegExp(rule.pattern.source, flags);
    let hit = false;
    for (const line of lines) {
      if (hit) break;
      global.lastIndex = 0;
      let match;
      while ((match = global.exec(line)) !== null) {
        if (rule.lineAllow !== undefined && rule.lineAllow.test(line)) break;
        if (rule.accept === undefined || rule.accept(match)) { hit = true; break; }
        if (match[0].length === 0) global.lastIndex += 1;
      }
    }
    if (hit) findings.push(rule.name);
  }
  for (const name of sensitiveNames) {
    const value = environment[name];
    if (value && value.length >= 20 && !value.startsWith("synthetic-") && content.includes(value)) findings.push("configured sensitive value (" + name + ")");
  }
  return findings;
}

export function trackedPaths() {
  return [...new Set(execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 30_000, windowsHide: true })
    .split("\0").filter(Boolean))];
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry).replaceAll("\\", "/");
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Scans tracked files plus every file under the extra directories; returns { scanned, findings: [[path, rule]] }. */
export function scanRepository(extraDirectories = [], environment = process.env) {
  const findings = [];
  const paths = [...trackedPaths(), ...extraDirectories.flatMap(walk)];
  let scanned = 0;
  for (const path of paths) {
    if (!existsSync(path)) continue;
    if (/(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith(".env.example")) {
      findings.push([path, "environment file must not be tracked"]);
      continue;
    }
    const base = path.split("/").pop() ?? path;
    if (!scannedExtension.test(path) && !scannedBasename.test(base)) continue;
    let content;
    try { content = readFileSync(path, "utf8"); } catch { findings.push([path, "unreadable file could not be scanned"]); continue; }
    scanned += 1;
    for (const rule of scanContent(path, content, environment)) findings.push([path, rule]);
    if (path.endsWith(".env.example")) {
      for (const line of content.split(/\r?\n/)) {
        if (line.trim() && !line.trim().startsWith("#") && !/^[A-Z][A-Z0-9_]*=$/.test(line.trim())) findings.push([path, "example must contain empty values only"]);
      }
    }
  }
  return { scanned, paths: paths.length, findings };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const extra = process.argv.filter((argument) => argument.startsWith("--extra=")).map((argument) => argument.slice(8));
  const result = scanRepository(extra);
  for (const [path, rule] of result.findings) console.error(path + ": " + rule);
  console.log(JSON.stringify({
    scanned_paths: result.paths, scanned_text_files: result.scanned, findings: result.findings.length, extra_directories: extra,
    scope: "tracked and non-ignored working files plus any --extra directories; heuristic rules (see tools/security-scan.mjs) and configured sensitive values when set",
  }));
  process.exitCode = result.findings.length ? 1 : 0;
}
