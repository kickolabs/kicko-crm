import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageAdapter } from './port';

// Local disk storage for development. Files live under .storage/ and are served
// through signed, short-lived app routes (/api/files/upload, /api/files/download).

const root = () => path.resolve(process.env.STORAGE_LOCAL_DIR ?? path.join(process.cwd(), '../../.storage'));
const secret = () => {
  const s = process.env.STORAGE_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error('STORAGE_SECRET or BETTER_AUTH_SECRET must be set');
  return s;
};

const KEY_RE = /^tenants\/[a-z0-9]+\/[A-Za-z0-9/_.-]+$/;
export function assertKey(key: string) {
  if (!KEY_RE.test(key) || key.includes('..')) throw new Error('Invalid storage key');
}

type Token = { k: string; op: 'put' | 'get'; exp: number; ct?: string; max?: number; n?: string; inl?: 1 };

export function signToken(t: Token) {
  const body = Buffer.from(JSON.stringify(t)).toString('base64url');
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`;
}

export function verifyToken(token: string | null, op: Token['op']): Token | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const t = JSON.parse(Buffer.from(body, 'base64url').toString()) as Token;
  if (t.op !== op || t.exp < Date.now()) return null;
  assertKey(t.k);
  return t;
}

const localPath = (key: string) => {
  assertKey(key);
  const base = root();
  const p = path.resolve(base, key);
  if (!p.startsWith(base + path.sep)) throw new Error('Invalid storage key');
  return p;
};

export async function writeLocal(key: string, data: Buffer) {
  const p = localPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data, { flag: 'wx' }); // never overwrite
}
export const readLocal = (key: string) => readFile(localPath(key));

export const localStorage: StorageAdapter = {
  id: 'local',
  async createUploadUrl(key, contentType, size) {
    const t = signToken({ k: key, op: 'put', exp: Date.now() + 600_000, ct: contentType, max: size });
    return { url: `/api/files/upload?t=${t}`, headers: { 'Content-Type': contentType } };
  },
  async createDownloadUrl(key, fileName, inline) {
    return `/api/files/download?t=${signToken({ k: key, op: 'get', exp: Date.now() + 300_000, n: fileName, ...(inline ? { inl: 1 as const } : {}) })}`;
  },
  async objectSize(key) {
    try {
      return (await stat(localPath(key))).size;
    } catch {
      return null;
    }
  },
  put: (key, data) => writeLocal(key, data),
  get: (key) => readLocal(key),
  async delete(key) {
    await rm(localPath(key), { force: true });
  },
};
