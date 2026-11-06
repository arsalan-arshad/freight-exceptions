// Server-side configuration read from the environment. Never import this file from a client component:
// it touches secrets (LLM_API_KEY). The UI only ever gets provider and model names via llmLabel().
import { createLlmClient, describeLlmConfig } from '@/ai';
import type { LlmClient } from '@/ai/types';

export { readConfig } from './env';
export type { AppConfig } from './env';
import { readConfig } from './env';

/** The configured model client, or null (no model configured, or demo mode). Never throws. */
export function getLlm(env: Record<string, string | undefined> = process.env): LlmClient | null {
  if (readConfig(env).demoMode) return null;
  try {
    return createLlmClient(env);
  } catch (e) {
    console.error('LLM configuration error:', e instanceof Error ? e.name : 'unknown');
    return null;
  }
}

/** What the UI may show about the model setup: provider and model names only, never a key. */
export function llmLabel(env: Record<string, string | undefined> = process.env): string {
  if (readConfig(env).demoMode) return 'Disabled in demo mode';
  const d = describeLlmConfig(env);
  if (d.configured) {
    const model = env.LLM_MODEL && env.LLM_MODEL.trim() ? ` (${env.LLM_MODEL.trim().slice(0, 80)})` : '';
    return `${d.provider ?? 'configured'}${model}`;
  }
  if (d.problem) return `Not usable: ${d.problem}. Drafts use the built-in template`;
  return 'None configured: drafts use the built-in template';
}
