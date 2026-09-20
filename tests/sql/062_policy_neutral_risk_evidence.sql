DO $$
DECLARE
  definition text;
BEGIN
  IF to_regclass('research.option_contract_risk_history') IS NULL THEN
    RAISE EXCEPTION 'option contract risk history view missing';
  END IF;
  SELECT pg_get_viewdef('research.option_contract_risk_history'::regclass, true) INTO definition;
  IF definition NOT LIKE '%candidate_point_in_time_evidence%'
     OR definition NOT LIKE '%execution_quote_observation%'
     OR definition NOT LIKE '%provider_timestamp%'
     OR definition NOT LIKE '%relative_spread%' THEN
    RAISE EXCEPTION 'option contract risk history view lacks canonical evidence/provenance';
  END IF;
END;
$$;
