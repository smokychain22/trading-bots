import { readFileSync } from 'node:fs';
import { validateDotProposal } from '../src/lab/contracts.js';
import { serializePublicDotProposal } from '../src/lab/proposal-exchange.js';

const files = process.argv.slice(2);
if (files.length === 0 || files.length > 20) throw new Error('DOT_PROPOSAL_FILES_REQUIRED_MAXIMUM_20');
for (const file of files) {
  try {
    const bytes = readFileSync(file);
    if (bytes.byteLength > 16 * 1024) throw new Error('DOT_PROPOSAL_TOO_LARGE');
    const raw = JSON.parse(bytes.toString('utf8'));
    const proposal = validateDotProposal(raw);
    serializePublicDotProposal(raw);
    process.stdout.write(JSON.stringify({ state: 'VALID_RESEARCH_PROPOSAL', proposalHash: proposal.proposalHash,
      strategyBranch: proposal.strategy.branch, brokerAuthority: false }) + '\n');
  } catch {
    process.stderr.write('DOT_PROPOSAL_VALIDATION_FAILED_NO_CONTENT_LOGGED\n');
    process.exitCode = 1;
  }
}
