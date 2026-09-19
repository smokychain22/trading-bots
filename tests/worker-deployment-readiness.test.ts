import assert from 'node:assert/strict';
import test from 'node:test';
import { assessWorkerDeploymentReadiness } from '../src/worker/deployment-readiness.js';

const dockerfile=`FROM runtime AS worker\nUSER node\nHEALTHCHECK CMD fetch('/healthz')`;
const compose=`services:\n  theta-worker:\n    env_file:\n      - .env.worker\n    environment:\n      THETA_WORKER_HOST_TYPE: "CONTAINER"\n      FOLLOWER_PAPER_EXECUTION_ENABLED: "false"\n    restart: unless-stopped\n    read_only: true\n    cap_drop:\n      - ALL`;

test('deployment package is ready only when safety controls and Docker engine are present',()=>{
  const ready=assessWorkerDeploymentReadiness({dockerfile,compose,dockerEngineAvailable:true});
  assert.equal(ready.status,'READY_TO_BUILD');
  assert.equal(ready.deployAuthorized,false);
  assert.equal(ready.mutationOwnerCutoverAuthorized,false);
  const blocked=assessWorkerDeploymentReadiness({dockerfile,compose,dockerEngineAvailable:false});
  assert.equal(blocked.status,'BLOCKED');
  assert.deepEqual(blocked.blockers,['dockerEngineAvailable']);
});

test('embedded secret-looking compose values fail readiness',()=>{
  const result=assessWorkerDeploymentReadiness({dockerfile,compose:`${compose}\n      DATABASE_URL: postgresql://unsafe`,dockerEngineAvailable:true});
  assert.equal(result.status,'BLOCKED');
  assert.ok(result.blockers.includes('noEmbeddedSecretValues'));
});
