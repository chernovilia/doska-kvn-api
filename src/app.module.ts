import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { RegionsModule } from './regions/regions.module';
import { AdsModule } from './ads/ads.module';
import { SeedModule } from './seed/seed.module';
import { AdminModule } from './admin/admin.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Три отдельных «ведра» rate-limita: короткий, средний, длинный.
    // Точечные @Throttle-ы на роутах ссылаются на них по name.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 60_000, limit: 30 },   // 30 запр/мин на IP (глобально)
      { name: 'medium', ttl: 60 * 60_000, limit: 300 }, // 300 запр/час
      { name: 'long', ttl: 24 * 60 * 60_000, limit: 5000 } // 5000 запр/сутки
    ]),
    PrismaModule,
    AuthModule,
    HealthModule,
    RegionsModule,
    AdsModule,
    SeedModule,
    AdminModule,
    UploadsModule
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
})
export class AppModule {}
