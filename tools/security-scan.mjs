// Prints paths and rule names only, never matching secret text.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const paths = [
  ...new Set(
    execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean),
  ),
];
const rules = [
  ["GitHub token", new RegExp("github" + "_pat_[A-Za-z0-9_]{40,}")],
  ["GitHub classic token", new RegExp("gh" + "[pousr]_[A-Za-z0-9]{30,}")],
  ["Vercel token", new RegExp("vc" + "p_[A-Za-z0-9]{30,}")],
  [
    "Private key",
    new RegExp("-----BEGIN (?:RSA |EC |OPENSSH )?" + "PRIVATE KEY-----"),
  ],
  ["AWS access key", new RegExp("AK" + "IA[A-Z0-9]{16}")],
];
const sensitiveNames = [
  "ALPACA_API_KEY",
  "ALPACA_SECRET_KEY",
  "OPTIONOMICS_API_KEY",
  "VERCEL_TOKEN",
  "THETA_READINESS_TOKEN",
  "ALPACA_OAUTH_CLIENT_SECRET",
  "PAPER_COPY_TOKEN_ENCRYPTION_KEY",
];
let failures = 0;
for (const path of paths) {
  if (!existsSync(path)) continue;
  if (/(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith(".env.example")) {
    console.error(path + ": environment file must not be tracked");
    failures++;
    continue;
  }
  if (
    !/\.(?:[cm]?[jt]sx?|json|md|ya?ml|sql|toml|html|css|py|example)$/.test(path)
  )
    continue;
  const content = readFileSync(path, "utf8");
  for (const [name, pattern] of rules)
    if (pattern.test(content)) {
      console.error(path + ": " + name);
      failures++;
    }
  for (const name of sensitiveNames) {
    const value = process.env[name];
    if (
      value &&
      value.length >= 20 &&
      !value.startsWith("synthetic-") &&
      content.includes(value)
    ) {
      console.error(path + ": configured sensitive value found");
      failures++;
    }
  }
  if (path.endsWith(".env.example")) {
    for (const line of content.split(/\r?\n/)) {
      if (
        line.trim() &&
        !line.trim().startsWith("#") &&
        !/^[A-Z][A-Z0-9_]*=$/.test(line.trim())
      ) {
        console.error(path + ": example must contain empty values only");
        failures++;
      }
    }
  }
}
console.log(
  JSON.stringify({
    scanned_paths: paths.length,
    findings: failures,
    scope:
      "tracked and nonignored working files; heuristic patterns plus configured sensitive values",
  }),
);
process.exitCode = failures ? 1 : 0;
