import { Pool } from "pg";

export type DatabaseReadiness = {
  readonly state: "MISSING" | "CONNECTED" | "MIGRATION_REQUIRED" | "DEGRADED";
  readonly checked_at: string;
  readonly connection_type: "TRANSACTION_POOLED_RUNTIME";
  readonly migration_connection_type: "DIRECT_OR_SESSION_POOLED";
  readonly latest_migration: string | null;
  readonly required_migration: "040_follower_paper_runtime";
  readonly customer_iam: boolean;
  readonly token_vault: boolean;
  readonly paper_execution_schema: boolean;
  readonly active_followers: number | null;
  readonly private_beta_followers: number | null;
  readonly follower_action_plans:number|null;
  readonly follower_reconciliation_events:number|null;
  readonly follower_divergence_events:number|null;
  readonly follower_runtime_checkpoints:number|null;
};

export async function checkDatabaseReadiness(
  databaseUrl: string | undefined,
): Promise<DatabaseReadiness> {
  const checkedAt = new Date().toISOString();
  const base = {
    checked_at: checkedAt,
    connection_type: "TRANSACTION_POOLED_RUNTIME" as const,
    migration_connection_type: "DIRECT_OR_SESSION_POOLED" as const,
    required_migration: "040_follower_paper_runtime" as const,
  };
  if (!databaseUrl) {
    return {
      ...base,
      state: "MISSING",
      latest_migration: null,
      customer_iam: false,
      token_vault: false,
      paper_execution_schema: false,
      active_followers: null,
      private_beta_followers: null,
      follower_action_plans:null,follower_reconciliation_events:null,
      follower_divergence_events:null,follower_runtime_checkpoints:null,
    };
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 1_000,
  });
  try {
    const objects = await pool.query(`SELECT
      to_regclass('core.schema_migration') IS NOT NULL AS migration_table,
      to_regclass('iam.customer_identity') IS NOT NULL AS customer_iam,
      to_regclass('copy.alpaca_oauth_token') IS NOT NULL AS token_vault,
      to_regclass('trade.execution_attempt') IS NOT NULL AS paper_execution_schema,
      to_regclass('copy.follower_account') IS NOT NULL AS follower_table,
      to_regclass('copy.follower_paper_action_plan') IS NOT NULL
        AND to_regclass('copy.follower_lifecycle_divergence_event') IS NOT NULL AS follower_runtime_schema`);
    const objectRow = objects.rows[0] ?? {};
    if (objectRow.migration_table !== true || objectRow.follower_table !== true || objectRow.follower_runtime_schema !== true) {
      return {
        ...base,
        state: "MIGRATION_REQUIRED",
        latest_migration: null,
        customer_iam: objectRow.customer_iam === true,
        token_vault: objectRow.token_vault === true,
        paper_execution_schema: objectRow.paper_execution_schema === true,
        active_followers: null,
        private_beta_followers: null,
        follower_action_plans:null,follower_reconciliation_events:null,
        follower_divergence_events:null,follower_runtime_checkpoints:null,
      };
    }
    const result = await pool.query(`
      SELECT
        (SELECT version FROM core.schema_migration ORDER BY version DESC LIMIT 1) AS latest_migration,
        EXISTS(SELECT 1 FROM core.schema_migration WHERE version = $1) AS required_migration_present,
        (SELECT count(*)::integer FROM copy.follower_account WHERE disconnected_at IS NULL) AS active_followers,
        (SELECT count(*)::integer FROM copy.follower_account
          WHERE disconnected_at IS NULL AND connection_method = 'PAPER_API_KEY_PRIVATE_BETA') AS private_beta_followers,
        (SELECT count(*)::integer FROM copy.follower_paper_action_plan) AS follower_action_plans,
        (SELECT count(*)::integer FROM copy.follower_reconciliation_event) AS follower_reconciliation_events,
        (SELECT count(*)::integer FROM copy.follower_lifecycle_divergence_event) AS follower_divergence_events,
        (SELECT count(*)::integer FROM copy.follower_runtime_checkpoint) AS follower_runtime_checkpoints
    `, [base.required_migration]);
    const row = result.rows[0] ?? {};
    const latest = typeof row.latest_migration === "string" ? row.latest_migration : null;
    return {
      ...base,
      state:
        row.required_migration_present === true && objectRow.customer_iam === true && objectRow.token_vault === true && objectRow.paper_execution_schema === true
          ? "CONNECTED"
          : "MIGRATION_REQUIRED",
      latest_migration: latest,
      customer_iam: objectRow.customer_iam === true,
      token_vault: objectRow.token_vault === true,
      paper_execution_schema: objectRow.paper_execution_schema === true,
      active_followers: typeof row.active_followers === "number" ? row.active_followers : null,
      private_beta_followers: typeof row.private_beta_followers === "number" ? row.private_beta_followers : null,
      follower_action_plans:typeof row.follower_action_plans==="number"?row.follower_action_plans:null,
      follower_reconciliation_events:typeof row.follower_reconciliation_events==="number"?row.follower_reconciliation_events:null,
      follower_divergence_events:typeof row.follower_divergence_events==="number"?row.follower_divergence_events:null,
      follower_runtime_checkpoints:typeof row.follower_runtime_checkpoints==="number"?row.follower_runtime_checkpoints:null,
    };
  } catch {
    return {
      ...base,
      state: "DEGRADED",
      latest_migration: null,
      customer_iam: false,
      token_vault: false,
      paper_execution_schema: false,
      active_followers: null,
      private_beta_followers: null,
      follower_action_plans:null,follower_reconciliation_events:null,
      follower_divergence_events:null,follower_runtime_checkpoints:null,
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}
