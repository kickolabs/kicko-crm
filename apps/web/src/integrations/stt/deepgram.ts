import 'server-only';
import { ProviderError } from '../core/types';
import type { SttAdapter } from './port';

// Deepgram pre-recorded API. nova-3 with language=multi handles English/Hindi code-switching.

type Utterance = { start: number; end: number; transcript: string; channel?: number; speaker?: number };

export function deepgram(apiKey: string): SttAdapter {
  return {
    id: 'deepgram',
    sandbox: false,
    async transcribe({ bytes, mime, channels }) {
      const q = new URLSearchParams({
        model: process.env.DEEPGRAM_MODEL ?? 'nova-3',
        language: process.env.DEEPGRAM_LANGUAGE ?? 'multi',
        smart_format: 'true',
        punctuate: 'true',
        utterances: 'true',
        ...(channels === 'dual' ? { multichannel: 'true' } : { diarize: 'true' }),
      });
      const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': mime },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(180_000),
      });
      const body = (await res.json().catch(() => ({}))) as {
        metadata?: { duration?: number };
        results?: { utterances?: Utterance[]; channels?: { detected_language?: string }[] };
        err_msg?: string;
      };
      if (!res.ok) throw new ProviderError(body.err_msg ?? `Deepgram error ${res.status}`, 'deepgram');
      const segments = (body.results?.utterances ?? []).map((u) => ({
        speaker: `Speaker ${(channels === 'dual' ? (u.channel ?? 0) : (u.speaker ?? 0)) + 1}`,
        start: u.start,
        end: u.end,
        text: u.transcript,
      }));
      return { segments, durationSec: body.metadata?.duration, language: body.results?.channels?.[0]?.detected_language };
    },
  };
}
