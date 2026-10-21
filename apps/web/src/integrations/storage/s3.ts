import 'server-only';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageAdapter } from './port';

// S3-compatible storage (Cloudflare R2 in production) with presigned URLs.

let client: S3Client | null = null;
const s3 = () =>
  (client ??= new S3Client({
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT, // R2: https://<account>.r2.cloudflarestorage.com
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  }));
const Bucket = () => process.env.S3_BUCKET!;

export const s3Storage: StorageAdapter = {
  id: 's3',
  async createUploadUrl(key, contentType, size) {
    const url = await getSignedUrl(s3(), new PutObjectCommand({ Bucket: Bucket(), Key: key, ContentType: contentType, ContentLength: size }), { expiresIn: 600 });
    return { url, headers: { 'Content-Type': contentType } };
  },
  createDownloadUrl(key, fileName, inline) {
    const disposition = `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
    return getSignedUrl(s3(), new GetObjectCommand({ Bucket: Bucket(), Key: key, ResponseContentDisposition: disposition }), { expiresIn: 300 });
  },
  async objectSize(key) {
    try {
      return (await s3().send(new HeadObjectCommand({ Bucket: Bucket(), Key: key }))).ContentLength ?? null;
    } catch {
      return null;
    }
  },
  async put(key, data, contentType) {
    await s3().send(new PutObjectCommand({ Bucket: Bucket(), Key: key, Body: data, ContentType: contentType }));
  },
  async get(key) {
    const res = await s3().send(new GetObjectCommand({ Bucket: Bucket(), Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  },
  async delete(key) {
    await s3().send(new DeleteObjectCommand({ Bucket: Bucket(), Key: key }));
  },
};
