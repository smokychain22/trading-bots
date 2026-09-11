import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
export const replayObservationSchema = z.object({
  replayObservationId: z.string().uuid(),
  fusionSnapshotId: z.string().uuid().nullable(),
  chainId: z.string().uuid().nullable(),
  underlying: z.string().min(1),
  contractSymbol: z.string().min(1).nullable(),
  strategyBranch: z.string().min(1).nullable(),
  asOf: z.string().datetime({ offset: true }),
  providerTimestamp: z.string().datetime({ offset: true }).nullable(),
  ingestedAt: z.string().datetime({ offset: true }),
  policyVersion: z.string().min(1),
  modelVersions: z.record(z.string(), z.string()),
  provenance: z.record(z.string(), z.unknown()),
  features: z.record(z.string(), z.unknown()),
  contentHash: hex64,
}).strict().superRefine((value, context) => {
  if (value.providerTimestamp !== null && Date.parse(value.providerTimestamp) > Date.parse(value.asOf)) {
    context.addIssue({ code: 'custom', message: 'providerTimestamp must not be after asOf' });
  }
  if (Date.parse(value.ingestedAt) < Date.parse(value.asOf)) {
    context.addIssue({ code: 'custom', message: 'ingestedAt must not precede asOf' });
  }
});

export const replayOutcomeLabelSchema = z.object({
  replayOutcomeLabelId: z.string().uuid(),
  replayObservationId: z.string().uuid(),
  labelAvailableAt: z.string().datetime({ offset: true }),
  censoringState: z.enum(['RESOLVED', 'RIGHT_CENSORED', 'INVALIDATED']),
  managedEpisodeOutcome: z.string().min(1).nullable(),
  wholeChainPnl: z.number().finite().nullable(),
  capitalDays: z.number().finite().nonnegative().nullable(),
  label: z.record(z.string(), z.unknown()),
}).strict();

export type ReplayObservation = z.infer<typeof replayObservationSchema>;
export type ReplayOutcomeLabel = z.infer<typeof replayOutcomeLabelSchema>;

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : item);

export function buildReplayObservation(
  input: Omit<ReplayObservation, 'replayObservationId' | 'contentHash'>,
): ReplayObservation {
  const contentHash = createHash('sha256').update(canonical(input)).digest('hex');
  return replayObservationSchema.parse({ ...input, replayObservationId: randomUUID(), contentHash });
}

export function assertLabelAvailableAfterObservation(
  observation: ReplayObservation,
  label: ReplayOutcomeLabel,
): void {
  if (label.replayObservationId !== observation.replayObservationId) throw new Error('REPLAY_LABEL_OBSERVATION_MISMATCH');
  if (Date.parse(label.labelAvailableAt) < Date.parse(observation.asOf)) throw new Error('REPLAY_LABEL_PRECEDES_OBSERVATION');
}

export class PostgresThetaReplayStore {
  constructor(private readonly pool: Pool) {}

  async saveObservation(raw: ReplayObservation): Promise<void> {
    const value = replayObservationSchema.parse(raw);
    const expectedHash = createHash('sha256').update(canonical({
      fusionSnapshotId: value.fusionSnapshotId, chainId: value.chainId, underlying: value.underlying,
      contractSymbol: value.contractSymbol, strategyBranch: value.strategyBranch, asOf: value.asOf,
      providerTimestamp: value.providerTimestamp, ingestedAt: value.ingestedAt, policyVersion: value.policyVersion,
      modelVersions: value.modelVersions, provenance: value.provenance, features: value.features,
    })).digest('hex');
    if (expectedHash !== value.contentHash) throw new Error('REPLAY_OBSERVATION_HASH_MISMATCH');
    await this.pool.query(
      `INSERT INTO research.theta_replay_observation(
        replay_observation_id,fusion_snapshot_id,chain_id,underlying,contract_symbol,strategy_branch,
        as_of,provider_timestamp,ingested_at,policy_version,model_versions_json,provenance_json,features_json,content_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14)
       ON CONFLICT(content_hash) DO NOTHING`,
      [value.replayObservationId, value.fusionSnapshotId, value.chainId, value.underlying, value.contractSymbol,
        value.strategyBranch, value.asOf, value.providerTimestamp, value.ingestedAt, value.policyVersion,
        JSON.stringify(value.modelVersions), JSON.stringify(value.provenance), JSON.stringify(value.features), value.contentHash],
    );
  }

  async saveOutcomeLabel(raw: ReplayOutcomeLabel): Promise<void> {
    const value = replayOutcomeLabelSchema.parse(raw);
    await this.pool.query(
      `INSERT INTO research.theta_replay_outcome_label(
        replay_outcome_label_id,replay_observation_id,label_available_at,censoring_state,
        managed_episode_outcome,whole_chain_pnl,capital_days,label_json)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [value.replayOutcomeLabelId, value.replayObservationId, value.labelAvailableAt, value.censoringState,
        value.managedEpisodeOutcome, value.wholeChainPnl, value.capitalDays, JSON.stringify(value.label)],
    );
  }
}
