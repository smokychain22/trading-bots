import { createHash } from 'node:crypto';

export interface ExecutedTestEvent {
  readonly file: string | null;
  readonly name: string;
  readonly state: 'PASS' | 'FAIL' | 'SKIPPED' | 'TODO';
}
export interface ReviewedRequirementBinding {
  readonly id: string;
  readonly reviewedBehavior: string;
  readonly sources: readonly string[];
  readonly tests: readonly { file: string; names: readonly string[] }[];
}

/** Source/test bytes are normalized only for checkout line endings. This does
 * not canonicalize or re-hash historical provider artifacts. */
export const evidenceSourceHash = (text: string): string =>
  createHash('sha256').update(text.replaceAll('\r\n','\n')).digest('hex');

export function certifyExecutedRequirement(binding: ReviewedRequirementBinding,
  events: readonly ExecutedTestEvent[], sourceHashes: Readonly<Record<string,string>>) {
  const blockers:string[]=[];
  if (!binding.reviewedBehavior.trim() || binding.sources.length===0 || binding.tests.length===0) {
    blockers.push('REVIEW_BINDING_INCOMPLETE');
  }
  const paths=[...new Set([...binding.sources,...binding.tests.map(test=>test.file)])].sort();
  for (const path of paths) if (!/^[a-f0-9]{64}$/.test(sourceHashes[path]??'')) blockers.push(`SOURCE_HASH_MISSING:${path}`);
  const matched:ExecutedTestEvent[]=[];
  for (const test of binding.tests) {
    if(test.names.length===0)blockers.push(`NO_REQUIRED_CASES:${test.file}`);
    const fileEvents=events.filter(event=>event.file===test.file);
    // A passing selected case cannot erase a failing companion in its suite.
    if(fileEvents.some(event=>event.state==='FAIL'))blockers.push(`TEST_FILE_FAILED:${test.file}`);
    for (const name of test.names) {
      const found=fileEvents.filter(event=>event.name===name);
      if(found.length!==1||found[0]?.state!=='PASS')blockers.push(`REQUIRED_TEST_NOT_UNIQUELY_PASSED:${test.file}:${name}`);
      else matched.push(found[0]);
    }
  }
  return {
    requirementId:binding.id,reviewedBehavior:binding.reviewedBehavior,
    state:blockers.length===0?'PASS' as const:'NOT_PROVEN' as const,
    scope:'SOURCE_ENGINEERING_ONLY' as const, runtimeProven:false, brokerAuthorized:false,
    passed:matched.length,failed:blockers.length,blockers,
    sourceHashes:Object.fromEntries(paths.map(path=>[path,sourceHashes[path]??null])),
    executedTests:matched,
  };
}
