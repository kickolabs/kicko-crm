import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmFor } from '../core/platform';

afterEach(() => vi.unstubAllEnvs());

describe('per-task model routing', () => {
  it('sends only the listed tasks to Kicko’s own model', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('KICKO_MODEL_URL', 'https://models.example/v1');
    vi.stubEnv('KICKO_MODEL_NAME', 'kicko-doc-8b');
    vi.stubEnv('KICKO_MODEL_TASKS', 'document_check, call_notes');
    expect(llmFor('document_check').id).toBe('kicko-model');
    expect(llmFor('call_notes').id).toBe('kicko-model');
    expect(llmFor('copilot_brief').id).toBe('anthropic');
  });

  it('falls back to Claude, or the sandbox, when no own model is configured', () => {
    vi.stubEnv('KICKO_MODEL_URL', '');
    vi.stubEnv('KICKO_MODEL_TASKS', 'document_check');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    expect(llmFor('document_check').id).toBe('anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(llmFor('document_check').sandbox).toBe(true);
  });

  it('reads structured output from a forced function call', async () => {
    vi.stubEnv('KICKO_MODEL_URL', 'https://models.example/v1/');
    vi.stubEnv('KICKO_MODEL_NAME', 'kicko-doc-8b');
    vi.stubEnv('KICKO_MODEL_TASKS', 'document_check');
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ function: { name: 'record_x', arguments: '{"ok":true}' } }] } }], usage: { prompt_tokens: 12, completion_tokens: 3 } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await llmFor('document_check').complete({ system: 's', messages: [{ role: 'user', content: 'hi' }], output: { name: 'record_x', description: 'd', schema: { type: 'object' } } });
    expect(res).toMatchObject({ data: { ok: true }, model: 'kicko-doc-8b', usage: { input: 12, output: 3 } });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://models.example/v1/chat/completions');
    vi.unstubAllGlobals();
  });
});
