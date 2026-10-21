// Speech-to-text port: call recordings → speaker-labelled transcript. Platform-owned.

export type Segment = { speaker: string; start: number; end: number; text: string };
export type Transcript = { segments: Segment[]; language?: string; durationSec?: number };

export type TranscribeInput = {
  bytes: Buffer;
  mime: string;
  /** Dual-channel recordings put each party on its own channel (better than diarisation). */
  channels?: 'dual' | 'mono';
  /** Provider recording reference (lets the sandbox return scripted transcripts). */
  sourceRef?: string;
};

export interface SttAdapter {
  id: string;
  sandbox: boolean;
  /** Null when this adapter can't transcribe the input (e.g. the sandbox given a real recording). */
  transcribe(input: TranscribeInput): Promise<Transcript | null>;
}
