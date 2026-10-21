import type { LlmAdapter } from './port';

// No model configured. AI features detect `sandbox` and use their own
// deterministic fallback, so flows stay testable without an API key.
export const sandboxLlm: LlmAdapter = {
  id: 'llm-sandbox',
  sandbox: true,
  async complete() {
    return { text: '', model: 'sandbox', usage: { input: 0, output: 0 } };
  },
};
