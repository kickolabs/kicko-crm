// Scripted conversations for the telephony sandbox. A sandbox call "records"
// one of these, and the sandbox speech-to-text returns it as the transcript.

export type ScriptTurn = ['agent' | 'contact', string];
export type CallScript = { id: string; label: string; durationSec: number; turns: ScriptTurn[] };

export const CALL_SCRIPTS: CallScript[] = [
  {
    id: 'study-canada',
    label: 'Study in Canada enquiry',
    durationSec: 214,
    turns: [
      ['agent', 'Hello, this is {agent} from {agency}. Am I speaking with {contact}?'],
      ['contact', 'Yes, hi. I filled your form about studying in Canada.'],
      ['agent', 'Great. Which course and intake are you looking at?'],
      ['contact', 'A postgraduate diploma in data analytics, for the September 2027 intake.'],
      ['agent', 'Have you taken IELTS yet?'],
      ['contact', 'Yes, I got 7.0 overall, no band below 6.5.'],
      ['agent', 'That meets most colleges. What is your budget for tuition and living for the first year?'],
      ['contact', 'Around 25 lakhs, my father is sponsoring.'],
      ['agent', "Good. I'll WhatsApp you the document checklist and shortlist three colleges. Can we meet on Saturday to finalise?"],
      ['contact', 'Saturday works. Please send the checklist today.'],
    ],
  },
  {
    id: 'pr-australia',
    label: 'Australia PR points query',
    durationSec: 342,
    turns: [
      ['agent', 'Good afternoon, {agency}, {agent} speaking.'],
      ['contact', 'Hi, this is {contact}. I want to know if I can apply for Australian PR, the 189 visa.'],
      ['agent', 'Sure. How old are you, and what is your occupation?'],
      ['contact', "I'm 31, a software engineer with six years of experience."],
      ['agent', 'And your English test?'],
      ['contact', 'PTE, 79 in each section.'],
      ['agent', 'That is superior English, 20 points. With your age and experience you may be around 85 points. We should do a skills assessment with the ACS first.'],
      ['contact', 'How long does that take, and what are your fees?'],
      ['agent', "About eight weeks. I'll email our fee schedule and the ACS document list. Shall I call you back on Monday?"],
      ['contact', 'Yes, Monday evening is fine.'],
    ],
  },
  {
    id: 'fee-followup',
    label: 'Unhappy client: fee follow-up',
    durationSec: 128,
    turns: [
      ['agent', 'Hi {contact}, {agent} from {agency}. Calling about your second instalment, which was due last week.'],
      ['contact', "I know. Honestly I'm not happy, nobody updated me on my file for two weeks."],
      ['agent', "I'm sorry about that. Your file was lodged on the 10th and we are waiting for biometrics instructions."],
      ['contact', "Okay, but I need updates. I'll pay by Friday if someone sends me the status in writing."],
      ['agent', "Understood. I'll send a written update on WhatsApp today and a payment link."],
    ],
  },
];

export const scriptById = (id: string) => CALL_SCRIPTS.find((s) => s.id === id) ?? CALL_SCRIPTS[0]!;

type Names = { agent: string; contact: string; agency: string };

/** sandbox:{scriptId}:{base64url names}, so the transcript can be personalised. */
export function sandboxRecordingRef(scriptId: string, names: Names) {
  return `sandbox:${scriptId}:${Buffer.from(JSON.stringify(names)).toString('base64url')}`;
}

export function parseSandboxRef(ref: string) {
  const [prefix, id, enc] = ref.split(':');
  if (prefix !== 'sandbox' || !id) return null;
  let names: Names = { agent: 'Counsellor', contact: 'there', agency: 'the agency' };
  try {
    if (enc) names = { ...names, ...(JSON.parse(Buffer.from(enc, 'base64url').toString()) as Partial<Names>) };
  } catch {
    // keep defaults
  }
  return { script: scriptById(id), names };
}

/** A few seconds of soft alternating tones, so the recording player has real audio to play. */
export function sandboxWav(seconds = 4) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const on = Math.floor(t * 2) % 2 === 0;
    const v = on ? Math.sin(2 * Math.PI * (Math.floor(t) % 2 ? 330 : 440) * t) * 0.08 : 0;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
