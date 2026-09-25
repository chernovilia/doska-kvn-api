import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { S3ClientService } from './s3.client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

// Ограничение на исходный файл, чтобы не тратить оперативку на 20 MB картинки —
// sharp всё равно сожмёт, но фильтруем на входе.
const MAX_INPUT_MB = 12;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/**
 * POST /v1/uploads/ad-photo — загрузка фото для объявления.
 *
 * Принимает multipart/form-data, поле `file`. Сжимает через sharp
 * до максимум 1600px по большей стороне, конвертирует в WebP,
 * кладёт в S3 в папку `ads/<yyyy>/<mm>/<uuid>.webp` и возвращает
 * публичный URL — фронт затем передаёт список URL в POST /ads.
 *
 * Требует авторизации: только залогиненный юзер может грузить.
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly s3: S3ClientService) {}

  // Rate-limit загрузки фото: 30 в час, 100 в сутки — с запасом на 6-фотных
  // объявлений (~5 объявлений в час = 30 фото).
  @Post('ad-photo')
  @Throttle({
    medium: { limit: 30, ttl: 60 * 60_000 },
    long: { limit: 100, ttl: 24 * 60 * 60_000 }
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_INPUT_MB * 1024 * 1024 }
    })
  )
  async uploadAdPhoto(
    @CurrentUser() userId: string,
    @UploadedFile() file?: Express.Multer.File
  ) {
    if (!this.s3.configured) {
      throw new BadRequestException('S3 не настроен на сервере');
    }
    if (!file) {
      throw new BadRequestException('Файл не передан (поле file)');
    }
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException(
        `Поддерживаемые форматы: JPEG, PNG, WebP, HEIC. Получен: ${file.mimetype}`
      );
    }

    // Сжимаем: max 1600px по большей стороне, WebP q80.
    // Автоповорот по EXIF, чтобы вертикальные фото с айфона не легли на бок.
    let processed: Buffer;
    try {
      processed = await sharp(file.buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Не удалось обработать изображение');
    }

    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const key = `ads/${yyyy}/${mm}/${crypto.randomUUID()}.webp`;

    const url = await this.s3.putObject({
      key,
      body: processed,
      contentType: 'image/webp'
    });

    return {
      url,
      key,
      size: processed.byteLength,
      uploadedBy: userId
    };
  }
}
