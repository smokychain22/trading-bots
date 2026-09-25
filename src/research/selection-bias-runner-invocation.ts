/**
 * COMMAND 5C-7 closure item 1: the real call path from a registered
 * filter-interaction trial (`filter-interaction-registry.ts`) through to
 * an actual `selection_bias_runner.py` invocation and back into a real
 * `SelectionBiasReceipt`. This is a RESEARCH-ONLY invoker, independent of
 * `src/theta/python-bridge.ts` (Codex-owned Production decision-runtime
 * infrastructure, not touched or imported here) -- it follows the same
 * safety discipline (fixed argv, no shell, no arbitrary script path) but
 * exists entirely in the research lane.
 *
 * `brokerAuthority: false` -- this invoker can only ever produce research
 * receipts; it has no path into any canonical decision output.
 */
import { spawn } from 'node:child_process';
import type { FilterInteractionTrialLedger } from './filter-interaction-registry.js';
import { buildSelectionBiasReceipt, type SelectionBiasReceipt } from './selection-bias-receipt.js';
import type { ReturnNormalizationVersion } from './return-normalization.js';

export const selectionBiasRunnerInvocationVersion = 'theta-selection-bias-runner-invocation-v1' as const;

export interface SelectionBiasRunnerInvocationConfig {
  readonly pythonExecutablePath: string;
  readonly quantWorkingDirectory: string; // absolute path to bots/theta/quant
  readonly timeoutMs: number;
}

export interface SelectionBiasCampaignRequest {
  readonly researchCampaignId: string;
  readonly returnNormalizationVersion: ReturnNormalizationVersion;
  readonly trialIdentities: readonly string[];
  readonly trialReturnSeries: Readonly<Record<string, readonly number[]>>;
  readonly inputDatasetHash: string;
  readonly dependencyGroupingVersion: string;
  readonly codeSha: string;
}

export type SelectionBiasRunnerInvocationResult =
  | { readonly ok: true; readonly receipt: SelectionBiasReceipt; readonly raw: Record<string, unknown> }
  | { readonly ok: false; readonly failureCode: 'PROCESS_ERROR' | 'NON_ZERO_EXIT' | 'MALFORMED_JSON' | 'RUNNER_REPORTED_ERROR' | 'TIMEOUT' | 'INSUFFICIENT_EVIDENCE'; readonly detail: string; readonly raw?: Record<string, unknown> };

/**
 * Real subprocess invocation: `python -m research.selection_bias_runner`,
 * run with `cwd = quantWorkingDirectory` (so the `research` package
 * resolves exactly as it does under pytest -- verified this pass by
 * direct invocation, not assumed). Never a shell string -- fixed argv
 * only. The campaign JSON goes on stdin; the receipt JSON comes back on
 * stdout, exactly matching `selection_bias_runner.py`'s real output
 * shape.
 */
export function invokeSelectionBiasRunner(
  config: SelectionBiasRunnerInvocationConfig, request: SelectionBiasCampaignRequest,
): Promise<SelectionBiasRunnerInvocationResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: SelectionBiasRunnerInvocationResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolve(result);
    };

    const child = spawn(config.pythonExecutablePath, ['-m', 'research.selection_bias_runner'], {
      cwd: config.quantWorkingDirectory, stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => finish({ ok: false, failureCode: 'TIMEOUT', detail: `Runner exceeded ${config.timeoutMs}ms.` }), config.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish({ ok: false, failureCode: 'PROCESS_ERROR', detail: error.message }));
    child.on('close', (exitCode) => {
      if (settled) return;
      if (exitCode !== 0) {
        finish({ ok: false, failureCode: 'NON_ZERO_EXIT', detail: stderr.trim().length > 0 ? stderr : `exit code ${String(exitCode)}` });
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        finish({ ok: false, failureCode: 'MALFORMED_JSON', detail: 'Runner stdout was not valid JSON.' });
        return;
      }
      if (typeof parsed.error === 'string') {
        finish({ ok: false, failureCode: 'RUNNER_REPORTED_ERROR', detail: parsed.error, raw: parsed });
        return;
      }
      // A full SelectionBiasReceipt requires BOTH a real dsr and a real
      // pbo result (the frozen Command 4 contract has no optional/
      // fabricated-placeholder field for either) -- if the runner could
      // not compute one of them (e.g. PBO is structurally undefined for
      // a single-trial campaign), this is reported honestly as
      // INSUFFICIENT_EVIDENCE with the real raw diagnostics attached,
      // never a receipt built from a fabricated placeholder value.
      if (parsed.dsr === null || parsed.pbo === null) {
        finish({ ok: false, failureCode: 'INSUFFICIENT_EVIDENCE', detail: 'Runner could not compute both a real DSR and a real PBO result for this campaign.', raw: parsed });
        return;
      }
      try {
        const receipt = buildSelectionBiasReceipt({
          researchCampaignId: parsed.researchCampaignId as string,
          returnNormalizationVersion: parsed.returnNormalizationVersion as string,
          numberOfTrials: parsed.numberOfTrials as number,
          trialIdentities: parsed.trialIdentities as readonly string[],
          dsr: parsed.dsr as SelectionBiasReceipt['dsr'],
          pbo: parsed.pbo as SelectionBiasReceipt['pbo'],
          inputDatasetHash: parsed.inputDatasetHash as string,
          dependencyGroupingVersion: parsed.dependencyGroupingVersion as string,
          codeSha: parsed.codeSha as string,
          createdAt: parsed.createdAt as string,
        });
        finish({ ok: true, receipt, raw: parsed });
      } catch (error) {
        finish({ ok: false, failureCode: 'MALFORMED_JSON', detail: error instanceof Error ? error.message : 'Receipt construction failed.', raw: parsed });
      }
    });

    child.stdin.write(JSON.stringify(request));
    child.stdin.end();
  });
}

/**
 * The real wiring point (closure item 1): builds a campaign request whose
 * `trialIdentities`/`numberOfTrials` come DIRECTLY from a real
 * `FilterInteractionTrialLedger` -- a registered-but-never-invoked ledger
 * can no longer silently diverge from what the DSR/PBO runner actually
 * receives as its trial count, since this function is the only place a
 * caller constructs the request from the ledger.
 */
export function buildCampaignRequestFromInteractionLedger(input: {
  readonly researchCampaignId: string;
  readonly returnNormalizationVersion: ReturnNormalizationVersion;
  readonly ledger: FilterInteractionTrialLedger;
  readonly trialReturnSeries: Readonly<Record<string, readonly number[]>>;
  readonly inputDatasetHash: string;
  readonly dependencyGroupingVersion: string;
  readonly codeSha: string;
}): SelectionBiasCampaignRequest {
  const trialIdentities = input.ledger.trialIdentities();
  if (trialIdentities.length === 0) throw new Error('SELECTION_BIAS_RUNNER_INVOCATION_EMPTY_LEDGER');
  for (const identity of trialIdentities) {
    if (!(identity in input.trialReturnSeries)) throw new Error(`SELECTION_BIAS_RUNNER_INVOCATION_MISSING_SERIES_FOR_TRIAL:${identity}`);
  }
  return {
    researchCampaignId: input.researchCampaignId, returnNormalizationVersion: input.returnNormalizationVersion,
    trialIdentities, trialReturnSeries: input.trialReturnSeries,
    inputDatasetHash: input.inputDatasetHash, dependencyGroupingVersion: input.dependencyGroupingVersion, codeSha: input.codeSha,
  };
}
