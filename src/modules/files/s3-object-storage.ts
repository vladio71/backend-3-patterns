// Адаптер S3 API. Для MinIO: S3_ENDPOINT=http://minio:9000 і S3_FORCE_PATH_STYLE=true.
// Для AWS S3: S3_ENDPOINT порожній або https://s3.<region>.amazonaws.com, ключі з IAM, S3_FORCE_PATH_STYLE=false.
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../../common/config';
import { HeadResult, ObjectStorage, PresignedPut } from './object-storage';

const EXPIRES_SEC = 300;

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig['storage']) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  /** ContentLength і ContentType входять у підпис: браузер мусить надіслати саме такі заголовки, інакше S3 відповість 403. */
  async presignPut(key: string, contentType: string, contentLength: number): Promise<PresignedPut> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: contentLength });
    const url = await getSignedUrl(this.client, command, { expiresIn: EXPIRES_SEC });
    return { url, method: 'PUT', headers: { 'Content-Type': contentType, 'Content-Length': String(contentLength) }, expiresInSec: EXPIRES_SEC };
  }

  presignGet(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: EXPIRES_SEC });
  }

  async head(key: string): Promise<HeadResult | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: result.ContentLength ?? 0, contentType: result.ContentType ?? null };
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') return null;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
