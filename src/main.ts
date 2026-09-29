import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import compression = require('compression');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false
  });
  const logger = new Logger('bootstrap');

  // req.ip — настоящий адрес клиента. Перед приложением на Amvera два внутренних прокси
  // (10.x): с 'trust proxy', 1 сервер видел 10.128.0.97 у всех, и гости делили один лимит.
  // Доверяем всем внутренним адресам — Express берёт первый внешний справа в X-Forwarded-For.
  // Подделать нельзя: адрес, который дописал прокси Amvera, стоит правее присланного клиентом.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  // gzip/brotli-клиентам: лента из 100 объявлений ~176 КБ → ~40 КБ
  app.use(compression());

  const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length > 0 ? origins : true,
    credentials: true,             // ← критично для cookies через кросс-домен
    exposedHeaders: ['x-total-count']
  });

  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  );

  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Doska/КВН API listening on :${port}`);
  logger.log(`CORS origins: ${origins.join(', ') || '(any)'}`);
  logger.log(
    `Cookie domain: ${process.env.COOKIE_DOMAIN || '(host-only)'}, secure=${
      process.env.COOKIE_SECURE !== 'false'
    }`
  );
}

bootstrap();
