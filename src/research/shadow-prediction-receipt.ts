/**
 * COMMAND 4 items 13-15 (COMMAND 2 §26/§29, COMMAND 3 §29-30). Shadow
 * prediction receipt + typed shadow-failure semantics. Research-only.
 *
 * `brokerAuthority` is a LITERAL `false` type (not just a runtime boolean
 * check) -- matching `profitability-brain-evidence-manifest.ts`'s
 * `environment: 'PAPER'` literal pattern (Command 1/3 finding): the type
 * system itself forecloses this receipt from ever declaring broker
 * authority, the same way that manifest structurally cannot express LIVE
 * authorization.
 *
 * Shadow failures are typed and CANNOT become a canonical decision output
 * -- there is no shared type between `ShadowFailureState` and any real
 * Production decision-output type (`WAIT`/`REJECT`/`0_EV`/`ALLOW`/`OPEN`
 * live in `strategy-package.ts`/`management-action-frontier.ts`, entirely
 * separate enums this module never imports or unions with).
 */

export const shadowPredictionReceiptVersion = 'theta-shadow-prediction-receipt-v1' as const;

export interface ShadowPredictionReceipt {
  readonly contractVersion: typeof shadowPredictionReceiptVersion;
  readonly predictionId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly targetId: string;
  readonly entityId: string;
  readonly decisionId: string;
  readonly featureSnapshotHash: string;
  readonly predictedAt: string;
  readonly prediction: number;
  readonly uncertainty: number | null;
  readonly sourceSha: string;
  readonly workerSha: string | null;
  readonly strategyScope: string;
  readonly shadowOnly: true;
  readonly brokerAuthority: false;
}

export function buildShadowPredictionReceipt(
  input: Omit<ShadowPredictionReceipt, 'contractVersion' | 'shadowOnly' | 'brokerAuthority'>,
): ShadowPredictionReceipt {
  if (!Number.isFinite(Date.parse(input.predictedAt))) throw new Error('SHADOW_PREDICTION_INVALID_PREDICTED_AT');
  if (!Number.isFinite(input.prediction)) throw new Error('SHADOW_PREDICTION_NON_FINITE');
  return { contractVersion: shadowPredictionReceiptVersion, ...input, shadowOnly: true, brokerAuthority: false };
}

export type ShadowFailureState =
  | 'SHADOW_UNAVAILABLE' | 'SHADOW_MODEL_TIMEOUT' | 'SHADOW_FEATURE_MISSING'
  | 'SHADOW_MODEL_NAN' | 'SHADOW_VERSION_MISMATCH' | 'SHADOW_UNSUPPORTED_STATE';

export interface ShadowFailureReceipt {
  readonly contractVersion: typeof shadowPredictionReceiptVersion;
  readonly failureId: string;
  readonly modelId: string;
  readonly entityId: string;
  readonly decisionId: string;
  readonly failureState: ShadowFailureState;
  readonly observedAt: string;
  readonly detail: string;
  readonly shadowOnly: true;
  readonly brokerAuthority: false;
}

export function buildShadowFailureReceipt(
  input: Omit<ShadowFailureReceipt, 'contractVersion' | 'shadowOnly' | 'brokerAuthority'>,
): ShadowFailureReceipt {
  return { contractVersion: shadowPredictionReceiptVersion, ...input, shadowOnly: true, brokerAuthority: false };
}

/**
 * The structural proof this module offers: given ANY `ShadowFailureState`,
 * this function's return type is `ShadowFailureReceipt` -- it is not
 * possible, by TypeScript's own type system, to construct a value of a
 * canonical decision-output type (imported from nowhere in this file) from
 * a `ShadowFailureState`. There is no conversion function anywhere in this
 * module or its dependents that maps `ShadowFailureState` to `WAIT`,
 * `REJECT`, `0_EV`, `ALLOW`, or `OPEN`.
 */
export function recordShadowFailure(input: Omit<ShadowFailureReceipt, 'contractVersion' | 'shadowOnly' | 'brokerAuthority'>): ShadowFailureReceipt {
  return buildShadowFailureReceipt(input);
}
