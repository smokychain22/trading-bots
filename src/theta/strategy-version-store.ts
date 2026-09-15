import type {Pool} from 'pg';
import type {ThetaStrategyVersion} from './strategy-package.js';
export async function registerImmutableStrategyVersion(pool:Pool,version:ThetaStrategyVersion):Promise<'INSERTED'|'UNCHANGED'>{
  const existing=await pool.query(`SELECT config_hash FROM core.strategy_version WHERE semantic_version=$1`,[`${version.strategyId}@${version.strategyVersion}`]);
  if(existing.rowCount===1){if(existing.rows[0]?.config_hash!==version.configurationHash)throw new Error('STRATEGY_VERSION_HASH_MISMATCH');return 'UNCHANGED';}
  await pool.query(`INSERT INTO core.strategy_version(semantic_version,config_json,config_hash,status) VALUES($1,$2::jsonb,$3,$4)`,
    [`${version.strategyId}@${version.strategyVersion}`,JSON.stringify(version),version.configurationHash,version.status]);
  return 'INSERTED';
}
