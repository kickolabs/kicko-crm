import 'server-only';
import type { Ctx } from '@/lib/tenant';
import { scopeOf } from '../scope';
import { voiceAgent, voiceSettings } from './agent';
import { PERSONAS } from './personas';

/** What the AI call button needs, or null when no voice agent is connected. */
export async function voiceFor(ctx: Ctx) {
  const conn = await voiceAgent(scopeOf(ctx));
  if (!conn) return null;
  return { sandbox: conn.sandbox, name: voiceSettings(ctx.tenant.settings).name, personas: PERSONAS.map(({ id, label }) => ({ id, label })) };
}
