// AI CONTRACT. Implemented in src/ai/*.ts, exported from src/ai/index.ts.
import type { ExceptionCase, Shipment } from '../core/types';

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

/** BYOK. Returns the raw text of the model reply. Never logs keys or prompts containing keys. */
export interface LlmClient {
  readonly name: string;
  complete(req: LlmRequest): Promise<string>;
}

export interface DraftResult {
  subject: string;
  body: string;
  origin: 'template' | 'llm';
  /** Empty when valid. If an LLM draft was invalid, the result falls back to the template and lists why here. */
  fallbackReasons: string[];
}

export interface DraftValidation {
  ok: boolean;
  violations: string[];
}

/** Signatures (implemented by the AI agent): see src/ai/index.ts
 *  createLlmClient(env: Record<string, string | undefined>): LlmClient | null   // LLM_PROVIDER=anthropic|openai, LLM_API_KEY, LLM_MODEL; null when unset
 *  class FakeLlmClient implements LlmClient   // constructor(responder: (req) => string | Promise<string>)
 *  templateDraft(c: ExceptionCase): { subject: string; body: string }   // deterministic, uses only c.facts
 *  validateDraft(text: string, c: ExceptionCase): DraftValidation       // every number/time/reference in text must come from c.facts
 *  draftFollowUp(c: ExceptionCase, shipment: Shipment, llm: LlmClient | null): Promise<DraftResult>
 */
