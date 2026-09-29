import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage
} from '@nestjs/throttler';
import { AuthService } from './auth/auth.service';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly auth: AuthService
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const token = req.cookies?.access_token;
    if (token) {
      try {
        const { userId } = await this.auth.verifyAccessToken(token);
        return `user:${userId}`;
      } catch {
        // Просроченный или поддельный токен — считаем как гостя.
      }
    }
    // Только req.ip (trust proxy 1 → адрес, который записал ингресс Amvera).
    // CF-Connecting-IP не читаем: прокси Cloudflare выключен, и заголовок может
    // прислать кто угодно — подставляя случайный «IP», обходили бы лимиты.
    return `ip:${req.ip}`;
  }
}
