import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser = require('cookie-parser');
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false
  });
  const logger = new Logger('bootstrap');

  // За Amvera/Cloudflare — важно, чтобы req.ip был реальным клиентским
  app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());

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
