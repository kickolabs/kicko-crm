import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { ZodError } from 'zod';
import { ForbiddenError } from './tenant';
import { UserError } from '@/server/scope';

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Run a mutation and turn expected failures into a result the form can show. */
export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_';
        fieldErrors[key] ??= issue.message;
      }
      return { ok: false, error: Object.values(fieldErrors)[0] ?? 'Check the form', fieldErrors };
    }
    if (err instanceof UserError || err instanceof ForbiddenError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export function formObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string' && !k.startsWith('$ACTION')) out[k] = v;
  return out;
}
