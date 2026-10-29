// Сховище в пам'яті для тестів. "Завантаження" це виклик upload(key, size, contentType), який у тесті грає роль браузера.
import { HeadResult, ObjectStorage, PresignedPut } from './object-storage';

export class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, HeadResult>();
  readonly presigned: string[] = [];

  async presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedPut> {
    this.presigned.push(key);
    return { url: `fake://bucket/${key}?sig=put&len=${contentLength}`, method: 'PUT', headers: { 'Content-Type': contentType, 'Content-Length': String(contentLength) }, expiresInSec: 300 };
  }

  async presignGet(key: string): Promise<string> {
    return `fake://bucket/${key}?sig=get`;
  }

  async head(key: string): Promise<HeadResult | null> {
    return this.objects.get(key) ?? null;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
  }

  /** Те, що робить браузер після presign: кладе байти за ключем. */
  upload(key: string, size: number, contentType: string): void {
    this.objects.set(key, { size, contentType });
  }
}
