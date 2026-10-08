import { dotProposalSource, validateDotProposal } from './contracts.js';

/** GitHub exchange is source/research configuration only. Never export a private lab receipt here. */
export function serializePublicDotProposal(input: unknown): string {
  const value = validateDotProposal(input);
  const serialized = JSON.stringify(dotProposalSource(value), null, 2);
  if (/\bPA[A-Z0-9]{8,}\b/.test(serialized)
    || /APCA-API|ALPACA_(API|SECRET)|Bearer\s|BEGIN .*PRIVATE KEY|account_number|providerAccountId/i.test(serialized)) {
    throw new Error('DOT_PUBLIC_EXCHANGE_SENSITIVE_CONTENT');
  }
  return serialized + '\n';
}
