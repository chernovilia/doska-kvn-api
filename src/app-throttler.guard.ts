import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage
} from '@nestjs/throttler';
import { AuthService } from './auth/auth.service';
import { validGid } from './guest-id';

// Запросы без cookie гостя (первый заход каждого посетителя, боты) делят один ключ —
// ему лимит в NEW_GUEST_FACTOR раз больше, чтобы первые заходы людей не упирались в потолок.
const NEW_GUEST_FACTOR = 10;
const EMAIL_ROUTES = /\/auth\/email\/(request|verify)$/;

/**
 * Ключ лимита: вошедший — userId; вход по коду — e-mail (лимит на почту, а не на сайт);
 * гость — анонимная cookie gid; без cookie — общий «новый гость».
 * IP не используем: за прокси Amvera он у всех одинаковый (см. guest-id.ts).
 */
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
    const path: string = req.originalUrl?.split('?')[0] || req.url || '';
    if (EMAIL_ROUTES.test(path) && typeof req.body?.email === 'string') {
      return `email:${req.body.email.trim().toLowerCase().slice(0, 200)}`;
    }
    const token = req.cookies?.access_token;
    if (token) {
      try {
        const { userId } = await this.auth.verifyAccessToken(token);
        return `user:${userId}`;
      } catch {
        // Просроченный или поддельный токен — считаем как гостя.
      }
    }
    if (!req.newGuest) {
      const gid = validGid(req.cookies?.gid);
      if (gid) return `guest:${gid}`;
    }
    return 'new-guest';
  }

  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const req = props.context.switchToHttp().getRequest();
    const tracker = await this.getTracker(req);
    if (tracker === 'new-guest') {
      return super.handleRequest({ ...props, limit: props.limit * NEW_GUEST_FACTOR });
    }
    return super.handleRequest(props);
  }
}
