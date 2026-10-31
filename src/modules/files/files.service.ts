// Зображення товарів: presign (браузер вантажить напряму в S3), confirm (HEAD-перевірка і запис у базу), список з presigned GET.
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { AppConfig, CONFIG } from '../../common/config';
import { ApiError, badRequest, isUniqueViolation, notFound } from '../../common/errors';
import { RequestContext } from '../../common/request-context';
import { TenantScopedRepository } from '../../common/tenant-scoped.repository';
import { ProductsService } from '../products/products.service';
import { OBJECT_STORAGE, ObjectStorage, PresignedPut } from './object-storage';
import { ProductImage } from './product-image.entity';

export type PresignResult = { key: string; upload: PresignedPut; maxBytes: number };
export type ImageView = { id: string; key: string; contentType: string; size: number; url: string };

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly images: TenantScopedRepository<ProductImage>;

  constructor(
    @InjectRepository(ProductImage) repo: Repository<ProductImage>,
    private readonly ctx: RequestContext,
    private readonly dataSource: DataSource,
    private readonly products: ProductsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {
    this.images = new TenantScopedRepository(repo, ctx);
  }

  async presign(productId: string, contentType: string, size: number): Promise<PresignResult> {
    const product = await this.products.getOrFail(productId);
    const maxBytes = this.config.storage.maxImageBytes;
    if (size > maxBytes) throw new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, 'IMAGE_TOO_LARGE', `Максимум ${maxBytes} байт`);
    const key = `tenants/${product.tenantId}/products/${product.id}/${randomUUID()}.${EXT[contentType]}`;
    const upload = await this.storage.presignPut(key, contentType, size);
    return { key, upload, maxBytes };
  }

  async confirm(productId: string, key: string): Promise<ImageView> {
    const product = await this.products.getOrFail(productId);
    const prefix = `tenants/${product.tenantId}/products/${product.id}/`;
    if (!key.startsWith(prefix)) throw badRequest('KEY_MISMATCH', 'Ключ не належить цьому товару'); // чужий ключ підтвердити не можна

    const head = await this.storage.head(key);
    if (!head) throw badRequest('OBJECT_NOT_UPLOADED', 'Файл за цим ключем ще не завантажено');
    if (head.size > this.config.storage.maxImageBytes) {
      await this.storage.remove(key);
      throw new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, 'IMAGE_TOO_LARGE', 'Завантажений файл більший за ліміт, видалено');
    }

    try {
      const image = await this.images.save(this.images.create({ productId: product.id, key, contentType: head.contentType ?? 'application/octet-stream', size: head.size }));
      return this.view(image, await this.storage.presignGet(key));
    } catch (error) {
      if (isUniqueViolation(error)) throw badRequest('ALREADY_CONFIRMED', 'Цей файл уже підтверджено');
      throw error;
    }
  }

  async list(productId: string): Promise<ImageView[]> {
    await this.products.getOrFail(productId);
    const rows = await this.images.find({ productId }, { createdAt: 'ASC' });
    const views: ImageView[] = [];
    for (const row of rows) views.push(this.view(row, await this.storage.presignGet(row.key)));
    return views;
  }

  async remove(productId: string, imageId: string): Promise<void> {
    const image = await this.images.findOne({ id: imageId, productId });
    if (!image) throw notFound('Зображення');

    // Спершу рядок у базі (в транзакції), потім об'єкт у S3. Порядок не випадковий:
    //   - S3 першим: об'єкт видалено, а DELETE у базі впав -> рядок є, файлу немає, клієнт отримує битий URL.
    //   - база першою: рядок видалено, а S3 впав -> у сховищі лишився "сирота", якого ніхто не бачить. Це лише зайві байти.
    // Другий варіант безпечніший, тому S3-помилку не показуємо клієнтові: зображення для нього вже видалене.
    await this.dataSource.transaction((manager) => manager.delete(ProductImage, { id: image.id, tenantId: image.tenantId }));
    try {
      await this.storage.remove(image.key);
    } catch (error) {
      // Об'єкт-сирота лишається в бакеті до завдання прибирання (знайти ключі в S3 без рядка в product_images і видалити, див. docs/modules/files.md).
      this.logger.error(`Рядок зображення ${image.id} видалено, але об'єкт ${image.key} у сховищі лишився: ${(error as Error).message}`);
    }
  }

  private view(image: ProductImage, url: string): ImageView {
    return { id: image.id, key: image.key, contentType: image.contentType, size: image.size, url };
  }
}
