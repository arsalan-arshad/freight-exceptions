// Shared helpers for ingest tests only (synthetic data, no real names).
import type { LlmClient, LlmRequest } from '../ai/types';
import { extractFromEmail } from './index';
import type { ExtractContext, VerifiedExtraction } from './index';

export class FakeLlm implements LlmClient {
  readonly name = 'fake';
  calls: LlmRequest[] = [];
  constructor(private responder: (req: LlmRequest) => string | Promise<string>) {}
  async complete(req: LlmRequest): Promise<string> {
    this.calls.push(req);
    return this.responder(req);
  }
}

export const EMAIL = `Hi team,
Load LD-1001 with Example Carrier LLC arrived at the delivery dock on 2026-03-05 at 11:00 EST.
Delivered 2026-03-05 12:50 EST. Signed POD attached.
Invoice total: USD 1,250.00 for this load.
New ETA is March 6, 2026 2:30 PM CST.
Thanks, Dispatch`;

export const CTX: ExtractContext = { messageId: 'msg-0001', receivedAt: '2026-03-05T18:00:00Z' };

export const item = (field: string, value: unknown, quote: string) => ({ field, value, quote });

export async function run(items: unknown, text = EMAIL, ctx: ExtractContext = CTX): Promise<{ r: VerifiedExtraction; llm: FakeLlm }> {
  const llm = new FakeLlm(() => (typeof items === 'string' ? items : JSON.stringify(items)));
  return { r: await extractFromEmail(text, llm, ctx), llm };
}

export const reasonOf = (r: VerifiedExtraction, field: string) => r.rejected.find((x) => x.field === field)?.reason;
