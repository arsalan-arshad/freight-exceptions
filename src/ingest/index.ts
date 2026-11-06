// Public API of the ingest module. Contract: see src/ingest/types.ts.
export { parseShipmentsCsv, parseCsvRecords, HEADER_ALIASES, normalizeHeader } from './csv';
export type { ParseCsvOptions } from './csv';
export { parseEml, parseEmailDate, htmlToText, decodeEncodedWords, MAX_BODY_CHARS, MAX_HTML_CHARS } from './eml';
export type { ParsedEmail } from './eml';
export { extractFromEmail, verifyProposedValues, stripQuotedReply, buildExtractionPrompt, REASONS } from './extract';
export type { VerifiedExtraction } from './extract';
export { applyExtraction } from './apply';
export type { ApplyOptions, ApplyOutcome } from './apply';
export { mergeShipments } from './merge';
export { normalizeReference, slugifyReference, parseAmountNumber, isIsoCurrency } from './util';
export { EXTRACTION_FIELDS } from './types';
export type {
  ParseIssue,
  CsvParseResult,
  ExtractionField,
  ExtractedValue,
  RejectedValue,
  ExtractionResult,
  ExtractContext,
} from './types';
