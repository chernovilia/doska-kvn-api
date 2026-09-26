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
    // За Cloudflare → Amvera ingress req.ip указывает на узел Cloudflare, а не на клиента.
    const cfIp = req.headers?.['cf-connecting-ip'];
    const ip = (Array.isArray(cfIp) ? cfIp[0] : cfIp) || req.ip;
    return `ip:${ip}`;
  }
}
