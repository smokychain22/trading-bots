BEGIN;

ALTER TABLE trade.master_paper_action_plan
  ADD COLUMN execution_tier text NOT NULL DEFAULT 'PAPER_EVIDENCE',
  ADD COLUMN canonical_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN paper_evidence_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN empirical_economics_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN expected_after_cost_ev numeric;

UPDATE trade.master_paper_action_plan SET
  execution_tier='EMPIRICALLY_PROMOTED_PAPER',
  canonical_quantity=COALESCE((plan_json->>'quantity')::integer,0),
  paper_evidence_quantity=COALESCE((plan_json->>'quantity')::integer,0),
  empirical_economics_ready=COALESCE((plan_json->>'empiricalEconomicsReady')::boolean,false),
  expected_after_cost_ev=(plan_json->>'expectedAfterCostEv')::numeric;

UPDATE trade.master_paper_action_plan SET
  plan_version='theta-master-paper-action-plan-v2',
  plan_json=plan_json || jsonb_build_object(
    'contractVersion','theta-master-paper-action-plan-v2',
    'executionTier',execution_tier,
    'canonicalQuantity',canonical_quantity,
    'paperEvidenceQuantity',paper_evidence_quantity,
    'paperEvidenceRiskCap',paper_evidence_quantity,
    'paperEvidenceCapReason',CASE WHEN paper_evidence_quantity=0 THEN 'QUANTITY_ZERO' ELSE 'CANONICAL_QUANTITY_LOWER' END
  );

ALTER TABLE trade.master_paper_action_plan
  ADD CONSTRAINT master_paper_action_plan_execution_tier_check
    CHECK(execution_tier IN ('PAPER_EVIDENCE','EMPIRICALLY_PROMOTED_PAPER')),
  ADD CONSTRAINT master_paper_action_plan_canonical_quantity_check CHECK(canonical_quantity >= 0),
  ADD CONSTRAINT master_paper_action_plan_paper_evidence_quantity_check CHECK(paper_evidence_quantity >= 0),
  ADD CONSTRAINT master_paper_evidence_quantity_reduces_only
    CHECK(paper_evidence_quantity <= canonical_quantity);

ALTER TABLE trade.order_intent
  ADD COLUMN execution_tier text NOT NULL DEFAULT 'PAPER_EVIDENCE',
  ADD COLUMN canonical_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN paper_evidence_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN empirical_economics_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN expected_after_cost_ev numeric;

UPDATE trade.order_intent SET execution_tier='EMPIRICALLY_PROMOTED_PAPER',canonical_quantity=quantity,paper_evidence_quantity=quantity;

ALTER TABLE trade.order_intent
  ADD CONSTRAINT order_intent_execution_tier_check CHECK(execution_tier IN ('PAPER_EVIDENCE','EMPIRICALLY_PROMOTED_PAPER')),
  ADD CONSTRAINT order_intent_canonical_quantity_check CHECK(canonical_quantity >= 0),
  ADD CONSTRAINT order_intent_paper_evidence_quantity_check CHECK(paper_evidence_quantity >= 0),
  ADD CONSTRAINT order_intent_paper_evidence_quantity_reduces_only
    CHECK(paper_evidence_quantity <= canonical_quantity),
  ADD CONSTRAINT order_intent_submitted_quantity_matches_evidence
    CHECK(quantity = paper_evidence_quantity);

INSERT INTO core.schema_migration(version,checksum)
VALUES('035_paper_evidence_authorization',repeat('0',64));

COMMIT;
