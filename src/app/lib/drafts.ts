// Draft lifecycle. Drafts are text for a person to review and copy. Nothing is sent.
import { createHash } from 'node:crypto';
import { draftFollowUp, validateDraft } from '@/ai';
import type { LlmClient } from '@/ai/types';
import type { DraftRecord, Store } from '@/db';
import type { ExceptionCase } from '@/core/types';
import { HttpError } from './http';

export interface DraftView {
  draft: DraftRecord;
  /** Facts check of the current text against the case facts. Empty when fine. */
  violations: string[];
  /** Why an LLM draft was replaced by the template. Only known right after generation. */
  fallbackReasons: string[];
  /**
   * True when the case facts changed after this draft was written (time passed, or new data arrived).
   * A stale draft cannot be approved or copied: regenerate it.
   */
  stale: boolean;
}

/** Stable fingerprint of a case's facts (key order does not matter). */
export function factsHash(c: ExceptionCase): string {
  const entries = Object.entries(c.facts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);
}

function isStale(draft: DraftRecord, c: ExceptionCase): boolean {
  // Drafts saved before fingerprints existed are judged by the facts check alone.
  return draft.factsHash !== undefined && draft.factsHash !== factsHash(c);
}

function checkText(subject: string, body: string, c: ExceptionCase): string[] {
  const v = validateDraft(`${subject}\n${body}`, c);
  return v.ok ? [] : v.violations;
}

async function mustGetCase(store: Store, id: string): Promise<ExceptionCase> {
  const c = await store.getCase(id);
  if (!c) throw new HttpError(404, 'Case not found.');
  return c;
}

export async function viewDraft(store: Store, c: ExceptionCase): Promise<DraftView | null> {
  const draft = await store.getDraft(c.id);
  if (!draft) return null;
  return { draft, violations: checkText(draft.subject, draft.body, c), fallbackReasons: [], stale: isStale(draft, c) };
}

export async function generateDraft(store: Store, caseId: string, llm: LlmClient | null, now: Date): Promise<DraftView> {
  const c = await mustGetCase(store, caseId);
  const shipment = await store.getShipment(c.shipmentId);
  if (!shipment) throw new HttpError(409, 'The shipment for this case is no longer stored.');
  const result = await draftFollowUp(c, shipment, llm);
  const ts = now.toISOString();
  const draft: DraftRecord = {
    caseId: c.id,
    subject: result.subject,
    body: result.body,
    origin: result.origin,
    approved: false,
    createdAt: ts,
    updatedAt: ts,
    factsHash: factsHash(c),
  };
  await store.saveDraft(draft);
  if (c.status === 'open') await store.setCaseStatus(c.id, 'drafted');
  return { draft, violations: checkText(draft.subject, draft.body, c), fallbackReasons: result.fallbackReasons, stale: false };
}

/** Save a person's edit. The text is always saved, approval is cleared, and violations are reported. */
export async function editDraft(store: Store, caseId: string, subject: string, body: string, now: Date): Promise<DraftView> {
  const c = await mustGetCase(store, caseId);
  const prev = await store.getDraft(caseId);
  if (!prev) throw new HttpError(404, 'There is no draft yet. Generate one first.');
  const draft: DraftRecord = {
    caseId,
    subject,
    body,
    origin: prev.origin,
    approved: false,
    createdAt: prev.createdAt,
    updatedAt: now.toISOString(),
    // The edit is checked against the facts as they are now, so it is current again.
    factsHash: factsHash(c),
  };
  await store.saveDraft(draft);
  return { draft, violations: checkText(subject, body, c), fallbackReasons: [], stale: false };
}

/** Mark the stored text as reviewed. Refused while the text contains values that are not in the case facts. */
export async function approveDraft(store: Store, caseId: string, now: Date): Promise<DraftView> {
  const c = await mustGetCase(store, caseId);
  const prev = await store.getDraft(caseId);
  if (!prev) throw new HttpError(404, 'There is no draft to approve.');
  if (isStale(prev, c)) {
    throw new HttpError(409, 'Cannot approve: the case facts changed since this draft was written (time has passed or new data arrived). Regenerate the draft, then review it.');
  }
  const violations = checkText(prev.subject, prev.body, c);
  if (violations.length > 0) {
    throw new HttpError(409, `Cannot approve: the draft contains values that are not in the case facts (${violations.join('; ')}).`);
  }
  if (prev.body.trim() === '' || prev.subject.trim() === '') throw new HttpError(409, 'Cannot approve an empty draft.');
  const ts = now.toISOString();
  const draft: DraftRecord = { ...prev, approved: true, approvedAt: ts, updatedAt: ts };
  await store.saveDraft(draft);
  return { draft, violations: [], fallbackReasons: [], stale: false };
}
