import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assessWorkerDeploymentReadiness } from '../src/worker/deployment-readiness.js';

const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
  encoding:'utf8', shell:false, windowsHide:true, timeout:5_000,
});
const receipt = assessWorkerDeploymentReadiness({
  dockerfile:readFileSync('Dockerfile','utf8'),
  compose:readFileSync('docker-compose.worker.example.yml','utf8'),
  dockerEngineAvailable:docker.status === 0 && docker.stdout.trim().length > 0,
});
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (receipt.status !== 'READY_TO_BUILD') process.exitCode = 2;
