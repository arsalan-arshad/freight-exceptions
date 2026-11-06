// INGEST CONTRACT. Implemented in src/ingest/*.ts, exported from src/ingest/index.ts.
import type { Shipment, SourceRef, ISODateTime } from '../core/types';
import type { LlmClient } from '../ai/types';

export interface ParseIssue {
  /** 1-based data row (header is row 0), if applicable */
  row?: number;
  message: string;
}

export interface CsvParseResult {
  shipments: Shipment[];
  issues: ParseIssue[];
}

/** Fixed extraction schema: the ONLY fields a model may propose from an email. */
export const EXTRACTION_FIELDS = [
  'reference',
  'carrier',
  'eta',
  'arrivedAt',
  'departedAt',
  'deliveredAt',
  'pickedUpAt',
  'invoiceAmount',
  'invoiceCurrency',
  'podAttached',
] as const;
export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];

export interface ExtractedValue {
  field: ExtractionField;
  /** Normalised value: ISO string for times, number for money, boolean for podAttached, string otherwise */
  value: string | number | boolean;
  /** Verbatim text copied from the source that supports the value */
  quote: string;
}

export interface RejectedValue {
  field: string;
  proposed: unknown;
  reason: string;
}

export interface ExtractionResult {
  accepted: ExtractedValue[];
  rejected: RejectedValue[];
  /** True when anything was rejected or the reference is missing: a person should look */
  needsReview: boolean;
}

export interface ExtractContext {
  /** Stable id of the message, e.g. "msg-0007" */
  messageId: string;
  /** Email "received at" if known; used to resolve times with no date */
  receivedAt?: ISODateTime;
  /** Offset like "-05:00" to assume when the email gives a time with no timezone. If unset, such times are rejected. */
  assumeOffset?: string;
}

/** Signatures (implemented by the ingest agent): see src/ingest/index.ts
 *  parseShipmentsCsv(text: string, opts?: { sourceName?: string }): CsvParseResult
 *  parseEml(raw: string): { subject?: string; from?: string; date?: string; body: string }
 *  extractFromEmail(text: string, llm: LlmClient, ctx: ExtractContext): Promise<ExtractionResult>
 *  applyExtraction(existing: Shipment[], result: ExtractionResult, source: SourceRef): { shipments: Shipment[]; matchedReference?: string; unmatched: boolean }
 *  mergeShipments(a: Shipment[], b: Shipment[]): Shipment[]   // by reference; dedupe events/docs by id
 */
