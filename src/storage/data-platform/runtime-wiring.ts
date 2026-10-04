// The one place that turns environment flags into data-platform behavior for the runtime. Everything is OFF unless explicitly enabled, so shipping this code changes nothing:
//   THETA_STORAGE_GOVERNOR=1          consult dp.storage_pressure_state (bulk research gating + the new-risk entry gate). Requires migration 069 and a written pressure row.
//   THETA_PIT_STORAGE_MODE=...        OFF | SHADOW | DUAL_WRITE_VALIDATE | AUTHORITATIVE (point-in-time evidence; see pit-writer.ts)
//   THETA_PIT_COMPACT_REJECTED=1      AUTHORITATIVE only: ordinary rejected rows keep identity/reason/hash only
//   THETA_DATA_PLATFORM_BLOB_STORE=1  complete cycle evidence goes to the partitioned dp.cycle_evidence_blob
//   THETA_PAYLOAD_DEDUP=1             raw provider payloads (research mode) are stored content-addressed in dp.payload_blob with separate observations
import type { Pool } from 'pg';
import { dataPlatformBlobStoreEnabled, postgresCycleBlobSink, type CycleBlobSink } from './cycle-blob-store.js';
import { pitModeFromEnvironment, type PitWriterConfig } from './pit-writer.js';
import { PostgresPressureProvider, newRiskGateFor, type PressureProvider } from './pressure-state.js';
import { postgresPayloadSink, type PayloadSink } from './payload-store.js';
import { StorageWriteGate, postgresSkipRecorder } from './write-gate.js';
import type { NewRiskGate } from './storage-governor.js';

export type Environment = Readonly<Record<string, string | undefined>>;
export const storageGovernorEnabled = (environment: Environment = process.env): boolean => environment.THETA_STORAGE_GOVERNOR === '1';

export interface DataPlatformRuntime {
  readonly governorEnabled: boolean;
  readonly provider: PressureProvider | null;
  readonly writeGate: StorageWriteGate | undefined;
  readonly cycleBlobSink: CycleBlobSink | undefined;
  readonly pitWriter: PitWriterConfig | undefined;
  readonly payloadSink: PayloadSink | undefined;
  /** the new-risk entry gate: OPEN when the governor is not enabled; management, closing and reconciliation never call this */
  newRiskGate(): Promise<{ readonly gate: NewRiskGate; readonly reason: string }>;
}

/** A cycle blob sink that asks the gate first. A denied blob is recorded (not silently dropped) and the decision transaction continues. */
export const gatedCycleBlobSink = (gate: StorageWriteGate | undefined, inner: CycleBlobSink = postgresCycleBlobSink): CycleBlobSink => async (client, record) => {
  if (gate !== undefined && !(await gate.allow('cycle-evidence-blob'))) return;
  await inner(client, record);
};

export function dataPlatformRuntime(pool: Pool, environment: Environment = process.env, now: () => Date = () => new Date()): DataPlatformRuntime {
  const governorEnabled = storageGovernorEnabled(environment);
  const provider = governorEnabled ? new PostgresPressureProvider(pool) : null;
  const writeGate = provider === null ? undefined : new StorageWriteGate(provider, { recorder: postgresSkipRecorder(pool), now });
  const mode = pitModeFromEnvironment(environment);
  const pitWriter: PitWriterConfig | undefined = mode === 'OFF' && writeGate === undefined ? undefined
    : { mode, ...(provider === null ? {} : { pressure: provider }), compactOrdinaryRejected: environment.THETA_PIT_COMPACT_REJECTED === '1', now };
  return {
    governorEnabled, provider, writeGate, pitWriter, payloadSink: environment.THETA_PAYLOAD_DEDUP === '1' ? postgresPayloadSink : undefined,
    cycleBlobSink: dataPlatformBlobStoreEnabled(environment) ? gatedCycleBlobSink(writeGate) : undefined,
    newRiskGate: async () => {
      if (provider === null) return { gate: 'OPEN', reason: 'STORAGE_GOVERNOR_DISABLED' };
      const result = await newRiskGateFor(provider, now());
      return { gate: result.gate, reason: result.reason };
    },
  };
}

/** The cycle store options contributed by the data platform (spread into PostgresThetaCycleStoreOptions). Empty when nothing is enabled. */
export function cycleStoreDataPlatformOptions(runtime: DataPlatformRuntime): { cycleBlobSink?: CycleBlobSink; pitWriter?: PitWriterConfig; writeGate?: StorageWriteGate; payloadSink?: PayloadSink } {
  return {
    ...(runtime.cycleBlobSink === undefined ? {} : { cycleBlobSink: runtime.cycleBlobSink }),
    ...(runtime.pitWriter === undefined ? {} : { pitWriter: runtime.pitWriter }),
    ...(runtime.writeGate === undefined ? {} : { writeGate: runtime.writeGate }),
    ...(runtime.payloadSink === undefined ? {} : { payloadSink: runtime.payloadSink }),
  };
}

/** Entry-plan admission under storage pressure: LOCKED blocks every new-risk plan, RESTRICTED admits at most one new plan per scan, OPEN changes nothing. */
export function admitNewRiskPlan(gate: NewRiskGate, plansAlreadyAdmitted: number): { readonly admitted: boolean; readonly blocker: string | null } {
  if (gate === 'LOCKED') return { admitted: false, blocker: 'STORAGE_NEW_RISK_LOCKED' };
  if (gate === 'RESTRICTED' && plansAlreadyAdmitted >= 1) return { admitted: false, blocker: 'STORAGE_NEW_RISK_RESTRICTED_ONE_PLAN_PER_SCAN' };
  return { admitted: true, blocker: null };
}
