export const workerDeploymentReadinessVersion = 'theta-worker-deployment-readiness-v1' as const;

export interface WorkerDeploymentReadinessInput {
  readonly dockerfile: string;
  readonly compose: string;
  readonly dockerEngineAvailable: boolean;
}

export interface WorkerDeploymentReadiness {
  readonly contractVersion: typeof workerDeploymentReadinessVersion;
  readonly status: 'READY_TO_BUILD' | 'BLOCKED';
  readonly checks: Readonly<Record<string, boolean>>;
  readonly blockers: readonly string[];
  readonly deployAuthorized: false;
  readonly mutationOwnerCutoverAuthorized: false;
}

export function assessWorkerDeploymentReadiness(input: WorkerDeploymentReadinessInput): WorkerDeploymentReadiness {
  const checks = {
    workerTarget: /FROM runtime AS worker/.test(input.dockerfile),
    nonRootRuntime: /USER node/.test(input.dockerfile),
    healthcheck: /HEALTHCHECK[\s\S]*\/healthz/.test(input.dockerfile),
    containerHostIdentity: /THETA_WORKER_HOST_TYPE:\s*["']?CONTAINER["']?/.test(input.compose),
    restartPolicy: /restart:\s*unless-stopped/.test(input.compose),
    readOnlyFilesystem: /read_only:\s*true/.test(input.compose),
    capabilitiesDropped: /cap_drop:[\s\S]*- ALL/.test(input.compose),
    followerExecutionLocked: /FOLLOWER_PAPER_EXECUTION_ENABLED:\s*["']false["']/.test(input.compose),
    envFileExternal: /env_file:[\s\S]*\.env\.worker/.test(input.compose),
    noEmbeddedSecretValues: !/(ALPACA_API_KEY|ALPACA_SECRET_KEY|OPTIONOMICS_API_KEY|DATABASE_URL):\s*["']?[^\s$][^\r\n]*/.test(input.compose),
    dockerEngineAvailable: input.dockerEngineAvailable,
  } as const;
  const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name).sort();
  return {
    contractVersion:workerDeploymentReadinessVersion, status:blockers.length === 0 ? 'READY_TO_BUILD' : 'BLOCKED',
    checks, blockers, deployAuthorized:false, mutationOwnerCutoverAuthorized:false,
  };
}
