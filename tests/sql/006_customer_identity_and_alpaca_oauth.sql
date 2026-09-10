\set ON_ERROR_STOP on
BEGIN;

INSERT INTO iam.customer_identity(customer_id, email_normalized, password_hash)
VALUES (
  '00000000-0000-0000-0000-000000000601',
  'customer@example.invalid',
  repeat('h', 64)
);

INSERT INTO iam.customer_session(session_hash, customer_id, expires_at)
VALUES (
  repeat('a', 64),
  '00000000-0000-0000-0000-000000000601',
  now() + interval '1 day'
);

INSERT INTO copy.alpaca_oauth_state(state_hash, customer_id, expires_at)
VALUES (
  repeat('b', 64),
  '00000000-0000-0000-0000-000000000601',
  now() + interval '10 minutes'
);

UPDATE copy.alpaca_oauth_state
SET consumed_at = now()
WHERE state_hash = repeat('b', 64) AND consumed_at IS NULL;

DO $$
DECLARE changed integer;
BEGIN
  UPDATE copy.alpaca_oauth_state
  SET consumed_at = now()
  WHERE state_hash = repeat('b', 64) AND consumed_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 THEN
    RAISE EXCEPTION 'OAuth state replay was accepted';
  END IF;
END $$;

INSERT INTO copy.alpaca_oauth_token(
  token_secret_id, customer_id, key_ref, ciphertext, iv, auth_tag, scope
) VALUES (
  '00000000-0000-0000-0000-000000000602',
  '00000000-0000-0000-0000-000000000601',
  'paper-copy-test-v1', decode('010203', 'hex'),
  decode(repeat('01', 12), 'hex'), decode(repeat('02', 16), 'hex'),
  'trading data'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO copy.alpaca_oauth_token(customer_id, key_ref, ciphertext, iv, auth_tag, scope)
    VALUES (
      '00000000-0000-0000-0000-000000000601', 'second-active-key',
      decode('04', 'hex'), decode(repeat('05', 12), 'hex'),
      decode(repeat('06', 16), 'hex'), 'trading'
    );
    RAISE EXCEPTION 'duplicate active token was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;

ROLLBACK;
