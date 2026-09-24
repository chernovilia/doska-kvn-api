import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';

/**
 * Guard авторизации:
 * — читает access_token из httpOnly cookie
 * — валидирует JWT
 * — пробрасывает req.userId
 *
 * В dev с AUTH_DEBUG_MODE=true — принимает X-Debug-User-Id header.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { userId?: string; cookies?: Record<string, string> }>();

    // Debug-режим (только dev)
    if (process.env.AUTH_DEBUG_MODE === 'true') {
      const debugId = req.headers['x-debug-user-id'] as string | undefined;
      if (debugId) {
        req.userId = debugId.trim();
        return true;
      }
    }

    const token = req.cookies?.access_token;
    if (!token) {
      throw new UnauthorizedException('No access token');
    }

    try {
      const { userId } = await this.auth.verifyAccessToken(token);
      req.userId = userId;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
