import 'server-only';
import { randomBytes } from 'node:crypto';
import { assertKey, localStorage, readLocal, signToken, verifyToken, writeLocal } from '@/integrations/storage/local';
import type { StorageAdapter } from '@/integrations/storage/port';
import { s3Storage } from '@/integrations/storage/s3';

// Storage facade. The platform's provider is chosen by STORAGE_DRIVER
// (local | s3). Features use these functions, never an adapter directly.

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const ADAPTERS: Record<string, StorageAdapter> = { local: localStorage, s3: s3Storage };
export const storageDriver = (process.env.STORAGE_DRIVER ?? 'local') as keyof typeof ADAPTERS;
const store = () => {
  const a = ADAPTERS[storageDriver];
  if (!a) throw new Error(`Unknown STORAGE_DRIVER "${storageDriver}"`);
  return a;
};

export { assertKey, signToken, verifyToken, writeLocal, readLocal };

/** tenants/{tenantId}/{area}/{random}.{ext} */
/** Server-written media (call recordings). Not accepted from browser uploads. */
export const MEDIA_EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/x-wav': 'wav', 'audio/wav': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

export function newKey(tenantId: string, area: string, contentType: string) {
  return `tenants/${tenantId}/${area}/${Date.now().toString(36)}-${randomBytes(9).toString('base64url')}.${ALLOWED_TYPES[contentType] ?? MEDIA_EXT[contentType] ?? 'bin'}`;
}

export async function createUploadUrl(key: string, contentType: string, size: number) {
  assertKey(key);
  if (!ALLOWED_TYPES[contentType]) throw new Error('Unsupported file type');
  if (size <= 0 || size > MAX_UPLOAD_BYTES) throw new Error('File too large');
  return store().createUploadUrl(key, contentType, size);
}

export async function createDownloadUrl(key: string, fileName: string, inline = true) {
  assertKey(key);
  return store().createDownloadUrl(key, fileName, inline);
}

/** Size of a stored object, or null when it doesn't exist (upload never completed). */
export async function objectSize(key: string) {
  assertKey(key);
  return store().objectSize(key);
}

export async function deleteObject(key: string) {
  assertKey(key);
  await store().delete(key);
}

/** Store bytes the server already has (e.g. WhatsApp media). */
export async function putObject(key: string, data: Buffer, contentType: string) {
  assertKey(key);
  await store().put(key, data, contentType);
}

export async function getObject(key: string) {
  assertKey(key);
  return store().get(key);
}

/** Copy an object to a new key (e.g. a WhatsApp attachment saved into a case document). */
export async function copyObject(from: string, to: string, contentType: string) {
  const data = await getObject(from);
  await putObject(to, data, contentType);
  return data.length;
}
