import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

/**
 * Клиент к Timeweb S3 (S3-совместимое хранилище).
 * Одна инстанция S3Client шарится на все загрузки.
 *
 * Требуемые env:
 *   TIMEWEB_S3_BUCKET
 *   TIMEWEB_S3_ACCESS_KEY_ID
 *   TIMEWEB_S3_SECRET_ACCESS_KEY
 *   TIMEWEB_S3_ENDPOINT      (например https://s3.timeweb.cloud)
 *   TIMEWEB_S3_REGION        (обычно ru-1)
 *   TIMEWEB_S3_PUBLIC_URL    (опционально: кастомный URL для отдачи)
 */
@Injectable()
export class S3ClientService implements OnModuleInit {
  private readonly logger = new Logger(S3ClientService.name);
  private client: S3Client;
  bucket!: string;
  endpoint!: string;
  publicUrlBase!: string;
  configured = false;

  onModuleInit() {
    const bucket = process.env.TIMEWEB_S3_BUCKET;
    const accessKeyId = process.env.TIMEWEB_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.TIMEWEB_S3_SECRET_ACCESS_KEY;
    const endpoint = process.env.TIMEWEB_S3_ENDPOINT || 'https://s3.timeweb.cloud';
    const region = process.env.TIMEWEB_S3_REGION || 'ru-1';

    if (!bucket || !accessKeyId || !secretAccessKey) {
      this.logger.warn(
        'S3 не сконфигурирован — установи TIMEWEB_S3_BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY. Загрузка фото работать не будет.'
      );
      return;
    }

    this.bucket = bucket;
    this.endpoint = endpoint;
    // Публичный URL для отдачи объектов. Если задан свой домен — используем его;
    // иначе строим из endpoint + bucket (path-style, работает у большинства S3-провайдеров).
    this.publicUrlBase =
      process.env.TIMEWEB_S3_PUBLIC_URL ||
      `${endpoint.replace(/\/$/, '')}/${bucket}`;

    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      // Timeweb требует path-style URLs (у них нет вирт-хоста для каждого бакета).
      forcePathStyle: true
    });
    this.configured = true;
    this.logger.log(`S3 готов: bucket=${bucket}, endpoint=${endpoint}`);
  }

  async putObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<string> {
    if (!this.configured) {
      throw new Error('S3 не сконфигурирован');
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable'
      })
    );
    return `${this.publicUrlBase}/${params.key}`;
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.configured) return;
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  // Из публичной ссылки достаём key (для удаления фото по URL).
  keyFromUrl(url: string): string | null {
    if (!url.startsWith(this.publicUrlBase + '/')) return null;
    return url.slice(this.publicUrlBase.length + 1);
  }
}
