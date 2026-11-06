import type { LlmClient, LlmRequest } from './types';

/** Test double. Records every request; the responder decides the reply (or throws / hangs). */
export class FakeLlmClient implements LlmClient {
  readonly name = 'fake';
  readonly calls: LlmRequest[] = [];
  constructor(private readonly responder: (req: LlmRequest) => string | Promise<string>) {}
  async complete(req: LlmRequest): Promise<string> {
    this.calls.push({ ...req });
    return this.responder(req);
  }
}
