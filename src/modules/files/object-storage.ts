// Порт для сховища файлів. Два адаптери: S3ObjectStorage (MinIO або AWS S3) і FakeObjectStorage (тести).
export type PresignedPut = { url: string; method: 'PUT'; headers: Record<string, string>; expiresInSec: number };
export type HeadResult = { size: number; contentType: string | null };

export interface ObjectStorage {
  presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedPut>;
  presignGet(key: string): Promise<string>;
  head(key: string): Promise<HeadResult | null>;
  remove(key: string): Promise<void>;
}

export const OBJECT_STORAGE = 'OBJECT_STORAGE';
