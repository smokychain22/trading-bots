import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  assessUnknownRegister,
  canonicalPreVpsUnknownAuditSummary,
  type UnknownRegister,
} from '../src/theta/pre-vps-unknown-register.js';
import { decisionCriticalEvidenceRegistryVersion, validateDecisionCriticalEvidenceRegistry } from '../src/theta/decision-critical-evidence-registry.js';

const path = fileURLToPath(new URL('../docs/operations/THETA_UNKNOWN_REGISTER_PRE_VPS.json', import.meta.url));
const register = JSON.parse(await readFile(path, 'utf8')) as UnknownRegister;
if (register.auditCoverage === 'COMPLETE') {
  if (register.denominatorContract !== decisionCriticalEvidenceRegistryVersion) throw new Error('UNKNOWN_REGISTER_DENOMINATOR_MISMATCH');
  validateDecisionCriticalEvidenceRegistry();
}
const result = assessUnknownRegister(register);
const expected = canonicalPreVpsUnknownAuditSummary;
if (register.denominatorContract !== expected.denominatorContract
  || result.auditCoverage !== expected.auditCoverage
  || result.avoidableUnknownCount !== expected.avoidableUnknownCount
  || result.avoidableUnknownCount !== expected.implementationBlockerCount
  || result.unresolvedSafetyCriticalCount !== expected.unresolvedSafetyCriticalCount
  || result.unresolvedPaperEntryCount !== expected.unresolvedPaperEntryCount) {
  throw new Error('UNKNOWN_AUDIT_SOURCE_SNAPSHOT_DRIFT');
}
console.log(JSON.stringify(result));
if (!result.preVpsReady) process.exitCode = 1;
