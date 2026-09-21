# THETA disaster recovery

Status: implemented and locally restore-tested on 2026-09-21. Production database writes, worker configuration, and trading authorization were not changed by the backup or restore tests.

## Audit and authority

- Local fixed-drive inventory found only `C:` as a healthy fixed data drive, with about 109 GiB free before backup creation. The chosen root is `C:\ProjectBackups\trading-bots\`, outside the repository, Downloads, Desktop, Temp, and application cache. The root has inherited access removed and grants the current Windows user, SYSTEM, and Administrators full control. Confirm whole-disk encryption separately because the available BitLocker query did not prove it is enabled.
- The protected Aiven read reported PostgreSQL 18.6, migration `064_alpaca_corporate_action_observation`, 12 schemas, 158 information-schema tables including five views, 46 functions, 220 information-schema trigger entries, 395 indexes, one sequence, and database size 631 MB at audit time. The full backup began later at 687 MB as the live database grew. `pg_dump` inventory counts 153 base/partitioned tables and five views. These are different counting definitions, not lost tables.
- Critical transactional families include two customer identities, two encrypted broker credentials, two broker-account records, one master role, decisions and candidate evidence, order intents, broker orders, fills, lifecycle/accounting, provider observations, scheduler/risk state, and 25,126 imported legacy artifact records at audit time. Aiven remains transactional authority. Alpaca remains broker truth. Optionomics remains an external research/analytics source.
- The repository contains static web assets under `public/assets`. No user-upload handler or application object-storage bucket was found in `api/`, `src/`, or the package dependencies. This is a code-path audit, not proof that no manually maintained external storage exists.
- Important data outside Aiven includes local `research_exports` (about 1.1 GB at audit), `research_outputs`, immutable `.theta-local-worker/evidence` (about 116 MB), and sanitized worker receipts. The backup copies only these allowlisted data folders. It excludes local worker tokens, `.env` files, runtime credentials, caches, and production secret values. The archive also carries a Git bundle so the committed source and migrations are portable.
- Neon remains an independent legacy historical source. This system does not mutate or delete Neon. Vercel configuration and secrets are separate and must be reconstructed through the secret inventory below.

## Files and schedule

Each verified run is published at `daily/<UTC timestamp>-<suffix>/` and contains `database.backup` (`pg_dump -Fc`), `schema.sql`, `database-inventory.json`, `extensions.json`, critical-table JSON, allowlisted external assets, `source-code.bundle`, `backup-manifest.json`, `SHA256SUMS.txt`, and `verification.json`. `latest/current.json` points to a verified daily run. Staging folders are never treated as valid backups and are removed on failure. A new failed run never rewrites a previous verified archive.

After each successful run, one independently copied and checksum-verified archive is kept per ISO week and month. Retention keeps seven daily, four weekly, and three monthly directory copies. Pruning runs only after a newly verified daily backup exists. It never targets the backup root or a computed path outside the selected bucket. The schedule is 02:15 local time, with `StartWhenAvailable` and no overlapping instances. The task runs under the current logged-in Windows user so user-bound DPAPI can decrypt the source URI and WSL can access the PostgreSQL 18 tools. A sleeping, powered-off, logged-out, or disconnected laptop cannot guarantee a daily run. Monitor the task and logs.

## First backup and verification

The source URI is stored under `config/aiven-url.dpapi`, encrypted for this Windows user. It is not in Git, the dump, or a log. `Set-ThetaBackupSource.ps1` accepts it through a masked local prompt and tests the server version before storing it. If the credential changes, remove the old encrypted file only after validating the new source and preserving a known-good backup. Do not paste the URI into documentation or a shell command line.

From the repository root:

```powershell
pwsh -NoProfile -File tools/windows/dr/Backup-Theta.ps1
pwsh -NoProfile -File tools/windows/dr/Verify-ThetaBackup.ps1 -BackupDirectory 'C:\ProjectBackups\trading-bots\daily\<verified-backup-id>'
pwsh -NoProfile -File tools/windows/dr/Test-ThetaRestore.ps1 -BackupDirectory 'C:\ProjectBackups\trading-bots\daily\<verified-backup-id>'
pwsh -NoProfile -File tools/windows/dr/Install-ThetaBackupTask.ps1
```

The scripts require PowerShell 7, WSL Ubuntu, and PostgreSQL 18 client tools at `/usr/lib/postgresql/18/bin`. A local PostgreSQL 18 test cluster listens on WSL socket port 5433. These tools were installed from the [official PostgreSQL Ubuntu Apt repository](https://www.postgresql.org/download/linux/ubuntu/). The backup script rejects insufficient free space before it starts and uses a consistent PostgreSQL dump snapshot. Human-readable critical-table JSON is supplementary. The custom archive is the complete database record.

## Restore to another PostgreSQL provider

1. Keep THETA new-risk execution locked. Stop the worker only when an actual cutover is authorized and coordinated. Record the current Alpaca Paper account, orders, fills, positions, and broker activities separately. A database backup cannot replace broker truth.
2. Select the latest `VERIFIED` archive, run the verification script, and provision a new empty PostgreSQL 18-or-newer database with required extensions available. The restore script refuses a target containing user tables, views, sequences, or foreign tables. It never uses `--clean`, `--if-exists`, or `--create` against a running database.
3. Supply the new target PostgreSQL URI to `Restore-Theta.ps1` through the `THETA_RESTORE_TARGET_URL` process environment or its `-TargetUrl` parameter. Environment use avoids a URL in the process command line. Restore external assets to a new, empty target directory. The script compares schemas, tables, views, functions, triggers, indexes, sequences, extensions, migration head, and selected critical row counts. It writes a restore receipt under `restore-tests/`.
4. Restore secret values separately through the new provider and deployment secret manager. Preserve the existing broker-credential encryption key if the encrypted database credentials must remain usable. Never commit or copy secret values into the backup repository.
5. Update `DATABASE_RUNTIME_AUTHORITY`, `AIVEN_DATABASE_URL`/`DATABASE_URL` routing deliberately for the new provider, redeploy the website and worker from the pinned Git source, and verify the app, migrations, customer sign-in, provider reads, and Alpaca reconciliation. Keep Paper entry locked until idempotency, open orders, fills, positions, leases, and account roles agree. Followers and live money stay disabled.

The script accepts a different provider, but the current production runtime code expects `DATABASE_RUNTIME_AUTHORITY=AIVEN` and `AIVEN_DATABASE_URL`. A migration to another provider therefore needs a tested environment-routing change and redeploy. Restoring bytes alone does not cut over the app.

## Secret inventory, names only

| Purpose | Names to restore separately |
| --- | --- |
| Database | `DATABASE_RUNTIME_AUTHORITY`, `AIVEN_DATABASE_URL` or the new canonical database URL, `DATABASE_URL`, `DATABASE_MIGRATION_URL`; optional read-only `NEON_ARCHIVE_DATABASE_URL` |
| Broker master/provider | `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`, `ALPACA_BASE_URL`, `ALPACA_DATA_URL`, `ALPACA_OPTIONS_FEED` |
| Customer encrypted credentials | `PAPER_COPY_TOKEN_ENCRYPTION_KEY`, `PAPER_COPY_TOKEN_KEY_REF`, `PRIVATE_PAPER_API_KEY_BETA_ENABLED` |
| Optionomics | `OPTIONOMICS_API_KEY`, `OPTIONOMICS_EMAIL`, `OPTIONOMICS_BASE_URL` |
| Optional public OAuth | `ALPACA_OAUTH_CLIENT_ID`, `ALPACA_OAUTH_CLIENT_SECRET`, `ALPACA_OAUTH_REDIRECT_URI` |
| Runtime/operator | `CRON_SECRET`, worker token and identity stored outside Git, `REDIS_URL` if used, Vercel project/org deployment identifiers and authorization |
| Safety settings | `PAPER_PAUSE_NEW_ORDERS`, `MASTER_PAPER_EXECUTION_ENABLED`, `FOLLOWER_PAPER_EXECUTION_ENABLED`, `THETA_RUNTIME_MODE`, worker enable/interval/lease settings |

The PostgreSQL dump includes encrypted broker credential rows, not the key needed to decrypt them. Windows DPAPI source-URI storage is bound to the current Windows user and machine profile. It must be reconfigured after a laptop migration. Avoid copying the DPAPI file as if it were a portable secret backup.

## Limits and additional resilience

A backup on the same laptop and `C:` drive removes Aiven as the only copy, but it does not survive loss or corruption of that laptop. Keep at least one encrypted offline or offsite copy of the verified backup root, with its decryption/recovery procedure tested separately. The backup script does not claim BitLocker is active. Local asset copies may lag a file being written concurrently; the included research exports and evidence are designed as immutable content-addressed artifacts, and all copied bytes are checksummed after copying. The PostgreSQL dump is internally snapshot-consistent. The supplementary JSON queries are taken after the dump and are not guaranteed to share the exact dump snapshot when production writes continue.
