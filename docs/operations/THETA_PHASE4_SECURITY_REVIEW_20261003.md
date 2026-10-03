# THETA Phase 4: security and public-repository hygiene review (2026-10-03)

The repository is public. This review covers secrets, tokens, broker keys, database URLs, logs, CI output, generated evidence, backup metadata,
the public GitHub history, Vercel logs and the dependency tree. No secret value appears in this document or in any command output kept in the repo.

## Findings

| Area | Method | Result |
|---|---|---|
| Tracked and non-ignored files (about 1,960 text files) | `tools/security-scan.mjs`, now with Alpaca key shapes, database URLs with real-looking passwords, bearer tokens, long secret literals, personal emails, user-home paths in docs, tokens/private keys | 4 privacy findings (one personal email, three docs with a local user-home path), all redacted; 0 remaining. A test (`tests/phase4-security-scan.test.ts`) keeps the tree at 0 and proves each rule fires on a realistic leak and stays quiet on legitimate fixtures |
| Git history (all refs, 1,345 commits) | added-line scan for key shapes, passworded database URLs, GitHub/Vercel/AWS tokens, private keys | 0 findings |
| Generated artifacts uploaded by CI (`.ci-test-evidence/`, `test-results/`, `playwright-report/`) | the scanner now runs over them before upload (`--extra=` directories, CI step) and `.ci-test-evidence/` is git-ignored | previously unscanned; now scanned on every run |
| Backup metadata (local, outside the repository) | search of the latest verified backup's JSON/SQL/TXT files | no connection string, API key or bearer token. `global-state.json` records the hashed role credentials (SCRAM verifiers) of the database roles. Accepted: the directory is local-only, never committed or uploaded (`backups/` and `*.backup` are ignored and the scanner covers any `--extra` path), and the full dump beside it is more sensitive than the verifiers |
| Vercel logs | `vercel logs` fields | request path, method and status only; no request body, header or token is logged |
| `.gitignore` | review | added `*.token`, `worker.token`, `*.bak`, `*.bacpac`, `backups/`, `.ci-test-evidence/`, `*.safetensors`, `*.ckpt`, `*.gguf` (a test pins the full list) |
| Test fixtures | review | the only credential-like constants are labelled fakes (`REALISTIC_FAKE_*`, `synthetic-*`); the maintainer's business address used as an environment fixture was replaced with `example.com` |

## Dependencies and supply chain

| Check | Result |
|---|---|
| `npm audit` (all 251 packages, production and development) | 0 advisories at every severity |
| Install scripts | none in the 15 direct dependencies; the only transitive install script is `esbuild` (via `tsx`) |
| Pending updates | patch/minor: `pg` 8.23.1, `tsx` 4.23.15, `typescript-eslint` 8.71.0, `zod` 4.6.5. Major: `eslint` 10, `pino` 10, `typescript` 7, `dotenv` 18, `@types/node` 26, `@reticlehq/browser` 3. Majors are NOT taken in Phase 4; each is a focused change with its own regression run |
| Automation | `.github/dependabot.yml` (weekly npm and GitHub Actions updates, majors excluded) |

## Known limits

- The configured-sensitive-value check only fires when those variables are set in the scanning environment (it is a backstop, not the primary control).
- History scanning is a one-off count in this review; a continuous history scan (for example gitleaks in CI) is a recommended addition, not a requirement met here.
- Browser trace archives (`.zip`) are not text-scanned; they are not committed and are uploaded only as short-lived CI artifacts.
