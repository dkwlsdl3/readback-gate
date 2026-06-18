import type { Report } from './types.ts';

export interface LlmEnhancement {
  better_prompt_example?: string;
}

export async function maybeEnhanceWithLlm(_prompt: string, report: Report): Promise<Report> {
  if (process.env.READBACK_GATE_LLM !== '1') {
    return report;
  }
  throw new Error('LLM enhancement is intentionally not implemented in v0 scoring path. Provide an opt-in enhancer in v1.');
}
