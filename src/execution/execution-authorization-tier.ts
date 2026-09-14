import { z } from 'zod';

export const executionAuthorizationTiers = [
  'PAPER_EVIDENCE', 'EMPIRICALLY_PROMOTED_PAPER', 'LIVE_ELIGIBLE', 'LIVE_AUTHORIZED',
] as const;
export type ExecutionAuthorizationTier = typeof executionAuthorizationTiers[number];

export interface PaperEvidenceSizing {
  readonly canonicalQuantity: number;
  readonly paperEvidenceQuantity: number;
  readonly paperEvidenceRiskCap: number;
  readonly paperEvidenceCapReason: 'PAPER_EVIDENCE_RISK_CAP' | 'CANONICAL_QUANTITY_LOWER' | 'QUANTITY_ZERO';
}

/** A separate Paper research cap can only reduce canonical sizing. Zero stays zero. */
export function applyPaperEvidenceRiskCap(canonicalQuantity:number,riskCap:number):PaperEvidenceSizing{
  const canonical=z.number().int().nonnegative().parse(canonicalQuantity);
  const cap=z.number().int().nonnegative().parse(riskCap);
  const quantity=Math.min(canonical,cap);
  return {canonicalQuantity:canonical,paperEvidenceQuantity:quantity,paperEvidenceRiskCap:cap,
    paperEvidenceCapReason:quantity===0?'QUANTITY_ZERO':cap<canonical?'PAPER_EVIDENCE_RISK_CAP':'CANONICAL_QUANTITY_LOWER'};
}
