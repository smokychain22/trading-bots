# Neon read-only export support request

Please restore a temporary read-only export window for Neon project `neon-almond-envelope` in the Vercel
`skillswap7/trading-bots` integration. The project is preserved and must not be deleted or mutated.

Both pooled and direct PostgreSQL connections return SQLSTATE `53000` with the project network-transfer
quota exhausted. The main branch and two Vercel preview branches are visible in the control plane, but the
SQL editor, Data API, Time Travel, snapshot inventory, and operation history cannot load data while the
quota is active.

We need one of these bounded recovery paths:

1. Temporarily restore read access long enough to run a complete `pg_dump` of every non-template database.
2. Provide a provider-generated, immutable PostgreSQL export or snapshot download with checksum.
3. Provide a one-time transfer-quota reset that allows the same read-only export.

No runtime writes, branch deletion, restore-over-production, or dual-database operation is requested. The
export will be hashed, restored into isolated Aiven staging, inventoried, deduplicated, and selectively
backfilled. Aiven remains the current runtime database and Neon remains historical evidence only.
