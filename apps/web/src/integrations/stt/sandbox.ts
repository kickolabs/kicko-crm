import { parseSandboxRef } from '../telephony/sandbox-scripts';
import type { SttAdapter } from './port';

// Returns the scripted transcript for sandbox recordings; can't transcribe real audio.
export const sandboxStt: SttAdapter = {
  id: 'stt-sandbox',
  sandbox: true,
  async transcribe({ sourceRef }) {
    const parsed = sourceRef ? parseSandboxRef(sourceRef) : null;
    if (!parsed) return null;
    const { script, names } = parsed;
    const fill = (s: string) => s.replace(/\{(agent|contact|agency)\}/g, (_, k: keyof typeof names) => names[k]);
    const per = script.durationSec / script.turns.length;
    return {
      language: 'en',
      durationSec: script.durationSec,
      segments: script.turns.map(([speaker, text], i) => ({ speaker, start: Math.round(i * per), end: Math.round((i + 1) * per), text: fill(text) })),
    };
  },
};
