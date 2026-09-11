\set ON_ERROR_STOP on
BEGIN;
INSERT INTO iam.workspace(workspace_id,name) VALUES
 ('00000000-0000-0000-0000-000000001001','role-test-one'),
 ('00000000-0000-0000-0000-000000001002','role-test-two');
INSERT INTO copy.follower_account(follower_account_id,workspace_id,provider_account_ref,
 oauth_secret_ref,account_role,participation) VALUES
 ('00000000-0000-0000-0000-000000001003','00000000-0000-0000-0000-000000001001',
 'synthetic-master-role','vault:synthetic','MASTER_THETA_PAPER','STOP_NEW_TRADES_MANAGE_EXISTING');
DO $$ BEGIN
 BEGIN
  INSERT INTO copy.follower_account(workspace_id,provider_account_ref,oauth_secret_ref)
  VALUES ('00000000-0000-0000-0000-000000001002','synthetic-master-role','vault:other');
  RAISE EXCEPTION 'duplicate broker identity accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO trade.execution_account(account_kind,follower_account_id,
    provider_account_ref_hash,provider_account_ref_masked)
  VALUES ('FOLLOWER_OAUTH','00000000-0000-0000-0000-000000001003',
    encode(digest('synthetic-master-role','sha256'),'hex'),'synthetic');
  RAISE EXCEPTION 'master follower execution accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE copy.follower_account SET participation='COPY_NEW_AND_MANAGE'
  WHERE follower_account_id='00000000-0000-0000-0000-000000001003';
  RAISE EXCEPTION 'self copy accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE copy.follower_account SET account_role='FOLLOWER_THETA_PAPER'
  WHERE follower_account_id='00000000-0000-0000-0000-000000001003';
  RAISE EXCEPTION 'master silently demoted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO copy.follower_policy(follower_account_id,policy_version,allocation_usd,
    max_bot_capital_pct,max_ticker_exposure_pct,max_contracts,max_daily_loss_usd,
    max_open_positions,max_slippage_per_contract_usd)
  VALUES ('00000000-0000-0000-0000-000000001003','synthetic',1000,10,10,1,100,1,1);
  RAISE EXCEPTION 'master follower policy accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO copy.follower_account(workspace_id,provider_account_ref,oauth_secret_ref,
    account_role,participation) VALUES ('00000000-0000-0000-0000-000000001002',
    'synthetic-second-master','vault:other','MASTER_THETA_PAPER','STOP_NEW_TRADES_MANAGE_EXISTING');
  RAISE EXCEPTION 'second master accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
-- Disconnect preserves role and identity. It must not free a self-copy loophole.
UPDATE copy.follower_account SET participation='DISCONNECTED',disconnected_at=now()
 WHERE follower_account_id='00000000-0000-0000-0000-000000001003';
DO $$ BEGIN
 BEGIN
  INSERT INTO copy.follower_account(workspace_id,provider_account_ref,oauth_secret_ref)
  VALUES ('00000000-0000-0000-0000-000000001002','synthetic-master-role','vault:other');
  RAISE EXCEPTION 'disconnected master copied';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
ROLLBACK;
