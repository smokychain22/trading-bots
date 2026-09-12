import { Pool } from 'pg';
import { buildR6ReadinessReceipt } from '../src/research/r6-readiness.js';

const connectionString=process.env.DATABASE_URL;
if(!connectionString) throw new Error('DATABASE_CONNECTION_NOT_CONFIGURED');
const pool=new Pool({connectionString,max:1});
try{
  const contexts=await pool.query(`SELECT bi.mode::text,count(*)::int AS count,
    count(*) FILTER(WHERE bi.strategy_version_id IS NOT NULL AND bi.feature_version_id IS NOT NULL
      AND bi.risk_limit_version_id IS NOT NULL AND bi.execution_version_id IS NOT NULL
      AND bi.cost_model_version_id IS NOT NULL)::int AS version_complete
    FROM core.bot_instance bi JOIN core.trading_account ta ON ta.account_id=bi.account_id
    WHERE bi.bot_code='THETA' AND ta.environment='PAPER' GROUP BY bi.mode ORDER BY bi.mode`);
  const counts=await pool.query(`SELECT
    (SELECT count(*) FROM trade.broker_order)::int AS master_paper_orders,
    (SELECT count(*) FROM trade.fill)::int AS broker_fills,
    (SELECT count(*) FROM copy.follower_account WHERE account_role='FOLLOWER_THETA_PAPER' AND disconnected_at IS NULL)::int AS followers`);
  process.stdout.write(`${JSON.stringify({runtimeContexts:contexts.rows,orders:{masterPaper:Number(counts.rows[0]?.master_paper_orders??0),
    followerPaper:0,live:0,brokerFills:Number(counts.rows[0]?.broker_fills??0)},r6:await buildR6ReadinessReceipt(pool)})}\n`);
}finally{await pool.end();}
