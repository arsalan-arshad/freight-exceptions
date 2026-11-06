// STORAGE CONTRACT. Implemented in src/db/*.ts, exported from src/db/index.ts.
import type { CaseStatus, ExceptionCase, Shipment, ISODateTime } from '../core/types';

export interface DraftRecord {
  caseId: string;
  subject: string;
  body: string;
  origin: 'template' | 'llm';
  /** The person has reviewed and approved this text. Approval never sends anything. */
  approved: boolean;
  approvedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  /** Fingerprint of the case facts the text was written and checked against. If the case facts change later, the draft is stale. */
  factsHash?: string;
}

export interface CaseFilter {
  status?: CaseStatus | CaseStatus[];
  ruleId?: string;
  shipmentId?: string;
}

/** Async so a Postgres adapter can implement it later. */
export interface Store {
  upsertShipments(shipments: Shipment[]): Promise<void>;
  listShipments(): Promise<Shipment[]>;
  getShipment(id: string): Promise<Shipment | null>;
  /**
   * Upsert by case id. For existing cases keep the person's `status` (resolved/dismissed/drafted)
   * and refresh the evidence/facts, EXCEPT: a case whose stored status is 'resolved' with resolvedBy 'data'
   * is re-opened (status 'open', resolvedBy cleared) because the exception is detected again.
   * Open cases whose exception no longer holds are NOT deleted here.
   */
  saveCases(cases: ExceptionCase[]): Promise<void>;
  listCases(filter?: CaseFilter): Promise<ExceptionCase[]>;
  getCase(id: string): Promise<ExceptionCase | null>;
  /** `by` records who resolved/dismissed it ('person' by default for a person's action; the pipeline passes 'data' when new data cleared the condition). */
  setCaseStatus(id: string, status: CaseStatus, by?: 'person' | 'data'): Promise<void>;
  saveDraft(draft: DraftRecord): Promise<void>;
  getDraft(caseId: string): Promise<DraftRecord | null>;
  /** Remove all data (used by demo reset and tests). */
  clearAll(): Promise<void>;
  close(): Promise<void>;
}
