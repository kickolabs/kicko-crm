// Storage port: private file storage for documents and attachments.
// Browsers upload/download with short-lived URLs; files are never public.

export interface StorageAdapter {
  id: string;
  createUploadUrl(key: string, contentType: string, size: number): Promise<{ url: string; headers: Record<string, string> }>;
  createDownloadUrl(key: string, fileName: string, inline: boolean): Promise<string>;
  objectSize(key: string): Promise<number | null>;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
