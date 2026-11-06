// Import and evaluation pipeline. Pure orchestration: rules decide exceptions, the model (optional) only
// extracts fields that are verified against the email text. Nothing here sends anything.
import { createHash } from 'node:crypto';
import { evaluateShipments } from '@/core';
import { generateSyntheticShipments } from '@/fixtures';
import {
  applyExtraction,
  extractFromEmail,
  mergeShipments,
  parseEmailDate,
  parseEml,
  parseShipmentsCsv,
  verifyProposedValues,
} from '@/ingest';
import type { ExtractContext, ExtractedValue, ExtractionResult, ParseIssue, RejectedValue } from '@/ingest/types';
import type { LlmClient } from '@/ai/types';
import type { Store } from '@/db';
import type { Shipment, SourceRef } from '@/core/types';

export interface RefreshSummary {
  shipmentsEvaluated: number;
  /** Exceptions the rules produce right now. */
  casesDetected: number;
  /** Cases that did not exist before this run. */
  newCases: number;
  /** Open or drafted cases whose condition no longer holds; marked resolved (by data). */
  autoResolved: { id: string; title: string }[];
  /** Cases that new data had resolved earlier but the rules detect again; re-opened. */
  reopened: { id: string; title: string }[];
}

export interface CsvImportSummary {
  kind: 'csv';
  sourceName: string;
  rowsParsed: number;
  /** Shipments that were new to the store. */
  added: number;
  /** Shipments that already existed (merged by reference). */
  updated: number;
  issues: ParseIssue[];
  /** True when the file produced no shipments at all (header only, empty, or every row rejected). */
  noDataRows: boolean;
  refresh: RefreshSummary;
}

export interface SampleSummary {
  kind: 'sample';
  shipmentsLoaded: number;
  refresh: RefreshSummary;
}

/** One value a model proposed. Only these three fields travel between preview and apply. */
export interface ProposedItem {
  field: string;
  value: string | number | boolean;
  quote: string;
}

/** Step 1 result: what the model proposed and what the checks say. NOTHING is stored. */
export interface EmailImportSummary {
  kind: 'email';
  messageId: string;
  subject?: string;
  /** Always false for a preview. */
  stored: false;
  /** Plain-language outcome for the UI. */
  message: string;
  accepted: ExtractedValue[];
  rejected: RejectedValue[];
  needsReview: boolean;
  /** The email contains instruction-like text; extracted values may have been steered. */
  injectionSuspected: boolean;
  /** The person must tick an explicit confirmation before applying (needsReview or injectionSuspected). */
  confirmationRequired: boolean;
  matchedReference?: string;
  unmatched: boolean;
  /** What applying the accepted values would do or skip, in plain language (from the ingest module). */
  notes: string[];
}

/** Step 2 result: what was stored after a person confirmed items. */
export interface EmailApplySummary {
  kind: 'email-applied';
  messageId: string;
  stored: boolean;
  message: string;
  accepted: ExtractedValue[];
  rejected: RejectedValue[];
  needsReview: boolean;
  injectionSuspected: boolean;
  matchedReference?: string;
  unmatched: boolean;
  notes: string[];
  refresh?: RefreshSummary;
}

function byId(list: Shipment[]): Map<string, Shipment> {
  return new Map(list.map((s) => [s.id, s]));
}

/**
 * Upsert shipments. When a shipment is already stored, the NEW data wins on conflicts (mergeShipments keeps the first
 * argument's values) and earlier events/documents that the new data does not mention (e.g. from an email) are kept.
 */
async function upsertMerged(store: Store, incoming: Shipment[]): Promise<{ added: number; updated: number }> {
  const existing = byId(await store.listShipments());
  const toWrite: Shipment[] = [];
  let added = 0;
  let updated = 0;
  for (const s of incoming) {
    const prev = existing.get(s.id);
    if (prev) {
      const merged = mergeShipments([s], [prev]);
      toWrite.push(...merged);
      updated++;
    } else {
      toWrite.push(s);
      added++;
    }
  }
  await store.upsertShipments(toWrite);
  return { added, updated };
}

/**
 * Re-run the rules over everything stored.
 * - Open or drafted cases the rules no longer produce are marked resolved (resolvedBy 'data').
 * - Cases that data had resolved and the rules produce again are re-opened (the store does that in saveCases).
 * - Cases a person resolved or dismissed stay as the person left them.
 */
export async function refreshCases(store: Store, now: Date): Promise<RefreshSummary> {
  const shipments = await store.listShipments();
  const produced = evaluateShipments(shipments, now);
  const before = await store.listCases();
  const beforeById = new Map(before.map((c) => [c.id, c]));
  const producedIds = new Set(produced.map((c) => c.id));

  const reopened = produced
    .filter((c) => {
      const prev = beforeById.get(c.id);
      return prev !== undefined && prev.status === 'resolved' && prev.resolvedBy === 'data';
    })
    .map((c) => ({ id: c.id, title: c.title }));

  await store.saveCases(produced);

  const autoResolved: { id: string; title: string }[] = [];
  for (const c of before) {
    if ((c.status === 'open' || c.status === 'drafted') && !producedIds.has(c.id)) {
      await store.setCaseStatus(c.id, 'resolved', 'data');
      autoResolved.push({ id: c.id, title: c.title });
    }
  }

  return {
    shipmentsEvaluated: shipments.length,
    casesDetected: produced.length,
    newCases: produced.filter((c) => !beforeById.has(c.id)).length,
    autoResolved,
    reopened,
  };
}

/** Load the synthetic demo shipments (fake names, times relative to `now`). Adds to what is stored. */
export async function loadSample(store: Store, now: Date): Promise<SampleSummary> {
  const sample = generateSyntheticShipments(now);
  await store.upsertShipments(sample);
  const refresh = await refreshCases(store, now);
  return { kind: 'sample', shipmentsLoaded: sample.length, refresh };
}

export async function importCsv(store: Store, text: string, now: Date, sourceName: string): Promise<CsvImportSummary> {
  const parsed = parseShipmentsCsv(text, { sourceName });
  const { added, updated } = await upsertMerged(store, parsed.shipments);
  const refresh = await refreshCases(store, now);
  return {
    kind: 'csv',
    sourceName,
    rowsParsed: parsed.shipments.length,
    added,
    updated,
    issues: parsed.issues,
    noDataRows: parsed.shipments.length === 0,
    refresh,
  };
}

function messageIdFor(raw: string): string {
  return 'msg-' + createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 10);
}

interface PreparedEmail {
  messageId: string;
  subject?: string;
  text: string;
  ctx: ExtractContext;
  receivedAt?: string;
  source: SourceRef;
}

function prepareEmail(raw: string): PreparedEmail {
  const messageId = messageIdFor(raw);
  const parsed = parseEml(raw);
  const text = [parsed.subject ? `Subject: ${parsed.subject}` : '', parsed.body].filter(Boolean).join('\n\n');
  const receivedAt = parseEmailDate(parsed.date);
  return {
    messageId,
    ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
    text,
    ...(receivedAt ? { receivedAt } : {}),
    ctx: { messageId, ...(receivedAt ? { receivedAt } : {}) },
    source: {
      kind: 'email',
      ref: `email:${messageId}`,
      ...(parsed.subject ? { excerpt: parsed.subject.slice(0, 200) } : {}),
    },
  };
}

function injectionFlag(r: ExtractionResult): boolean {
  return (r as { injectionSuspected?: boolean }).injectionSuspected === true;
}

/**
 * STEP 1 of the email import (preview). Asks the model to propose values, verifies each against the email text,
 * and reports. It STORES NOTHING: a value that came out of a model never changes an exception until a person
 * confirms it in step 2 (applyEmailItems).
 */
export async function importEmail(store: Store, raw: string, llm: LlmClient | null, _now: Date): Promise<EmailImportSummary> {
  void _now;
  const prep = prepareEmail(raw);
  const base = {
    kind: 'email' as const,
    messageId: prep.messageId,
    ...(prep.subject !== undefined ? { subject: prep.subject } : {}),
    stored: false as const,
    accepted: [] as ExtractedValue[],
    rejected: [] as RejectedValue[],
    needsReview: true,
    injectionSuspected: false,
    confirmationRequired: true,
    unmatched: true,
    notes: [] as string[],
  };

  if (!llm) {
    return {
      ...base,
      message:
        'Email extraction needs a model, and none is configured (set LLM_PROVIDER, LLM_API_KEY and LLM_MODEL). Nothing was stored. CSV import works without a model.',
    };
  }
  if (prep.text.trim() === '') return { ...base, message: 'The pasted email has no readable text. Nothing was stored.' };

  const result = await extractFromEmail(prep.text, llm, prep.ctx);
  const injection = injectionFlag(result);
  // Dry run: applyExtraction is pure, so this only tells the person what confirming would do.
  const applied = applyExtraction(await store.listShipments(), result, prep.source, prep.receivedAt ? { receivedAt: prep.receivedAt } : {});
  const needsReview = result.needsReview || injection;

  const common = {
    ...base,
    accepted: result.accepted,
    rejected: result.rejected,
    needsReview,
    injectionSuspected: injection,
    confirmationRequired: needsReview,
    unmatched: applied.unmatched,
    notes: applied.notes,
    ...(applied.matchedReference !== undefined ? { matchedReference: applied.matchedReference } : {}),
  };

  if (applied.unmatched) {
    const ref = result.accepted.find((a) => a.field === 'reference');
    return {
      ...common,
      message: ref
        ? `No stored shipment matches the reference "${String(ref.value)}". Emails never create shipments, so there is nothing to apply. Import the shipment by CSV first.`
        : 'No verified shipment reference was found in the email, so there is nothing to attach. Nothing was stored.',
    };
  }
  return {
    ...common,
    message: `Nothing is stored yet. ${result.accepted.length} value(s) passed the text check for ${applied.matchedReference}. Tick the ones that are right, compare them with the original email, and apply.${
      needsReview ? ' This email needs a person\u2019s review before anything is applied.' : ''
    }`,
  };
}

/**
 * STEP 2 of the email import. The person has ticked items in the preview. They are RE-VERIFIED against the email
 * text by code (never trusting what the browser sends), then attached to the matching existing shipment.
 * If the checks flag the email (rejections, no reference, or instruction-like text) nothing is applied unless the
 * person explicitly confirmed the warning.
 */
export async function applyEmailItems(
  store: Store,
  raw: string,
  items: ProposedItem[],
  confirmedReview: boolean,
  now: Date,
): Promise<EmailApplySummary> {
  const prep = prepareEmail(raw);
  const result = verifyProposedValues(prep.text, items, prep.ctx);
  const injection = injectionFlag(result);
  const base = {
    kind: 'email-applied' as const,
    messageId: prep.messageId,
    accepted: result.accepted,
    rejected: result.rejected,
    needsReview: result.needsReview || injection,
    injectionSuspected: injection,
  };

  if (items.length === 0) {
    return { ...base, stored: false, unmatched: true, notes: [], message: 'No items were selected. Nothing was stored.' };
  }
  if (base.needsReview && !confirmedReview) {
    return {
      ...base,
      stored: false,
      unmatched: true,
      notes: [],
      message:
        'Not applied: the checks flagged this email (a value was rejected, the reference is missing, or the text contains instruction-like phrases). Tick the confirmation box if you have compared the values with the original email.',
    };
  }

  const applied = applyExtraction(await store.listShipments(), result, prep.source, prep.receivedAt ? { receivedAt: prep.receivedAt } : {});
  const common = {
    ...base,
    unmatched: applied.unmatched,
    notes: applied.notes,
    ...(applied.matchedReference !== undefined ? { matchedReference: applied.matchedReference } : {}),
  };
  if (applied.unmatched) {
    return { ...common, stored: false, message: 'No stored shipment matches the confirmed reference, so nothing was stored. Emails never create shipments.' };
  }
  await store.upsertShipments(applied.shipments);
  const refresh = await refreshCases(store, now);
  return {
    ...common,
    stored: true,
    message: `Attached ${result.accepted.length} confirmed value(s) to ${applied.matchedReference}.`,
    refresh,
  };
}
