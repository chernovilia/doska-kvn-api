import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { RegionsModule } from './regions/regions.module';
import { AdsModule } from './ads/ads.module';
import { SeedModule } from './seed/seed.module';
import { AdminModule } from './admin/admin.module';
import { UploadsModule } from './uploads/uploads.module';
import { ChatsModule } from './chats/chats.module';
import { FavoritesModule } from './favorites/favorites.module';
import { UsersModule } from './users/users.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Глобальные лимиты — только от долбёжки: у мобильных операторов много абонентов
    // за одним IP (CGNAT), а лента на одну загрузку делает несколько запросов.
    // Строгие лимиты — точечными @Throttle на эндпоинтах, они считаются по userId.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 60_000, limit: 300 },
      { name: 'medium', ttl: 60 * 60_000, limit: 5_000 },
      { name: 'long', ttl: 24 * 60 * 60_000, limit: 50_000 }
    ]),
    PrismaModule,
    AuthModule,
    HealthModule,
    RegionsModule,
    AdsModule,
    SeedModule,
    AdminModule,
    UploadsModule,
    ChatsModule,
    FavoritesModule,
    UsersModule,
    NotificationsModule,
    ReviewsModule
  ],
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }]
})
export class AppModule {}
