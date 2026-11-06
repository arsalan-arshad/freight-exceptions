// DOCUMENTED LIMITATIONS. These tests describe what validateDraft cannot catch. They are skipped on purpose:
// a deterministic check on text cannot know who the recipient is, where a truck is, or what a person agreed, so a
// sentence that uses no digit, no listed word and no unverifiable-looking token passes. The mitigations that DO exist
// are: the model sees only facts, drafts must open with the right addressee pattern (draft.ts), the template is the
// fallback, and a person reads and approves every message. Do not "fix" these by loosening the skip; remove the skip
// only if a real mechanism is added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft } from './index';
import { CASES } from './test-helpers';

const c = CASES['LATE-DEL'];
const PRE = 'Hello Example Carrier LLC team, could you send an ETA for load LD-4821? ';

test('KNOWN LIMITATION: false-status or wrong-party sentences that use no flagged word are not detected', { skip: 'cannot be decided deterministically; a person approves every message' }, () => {
  const undetected = ['The truck is parked at the Springfield dock.', 'Your colleague Pat already agreed to this.', 'The receiver closed early.', 'Your dispatcher told us it was on the way.'];
  assert.deepEqual(undetected.filter((s) => validateDraft(PRE + s, c).ok), []);
});

test('KNOWN LIMITATION: number words in languages beyond es/fr/de/pt/it are not detected', { skip: 'word lists are finite' }, () => {
  assert.equal(validateDraft(PRE + 'Antwoord binnen vierentwintig uur', c).ok, false);
});
