import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Тестовая авторизация: если AUTH_DEBUG_MODE=true, ждём заголовок X-Debug-User-Id.
 * Это временная заглушка на этап 2. На этапе 3 заменим на JWT (SMS/email).
 *
 * Использование в контроллере:
 *   @UseGuards(AuthGuard)
 *   @Get('me')
 *   me(@CurrentUser() userId: string) { ... }
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { userId?: string }>();
    const debug = process.env.AUTH_DEBUG_MODE === 'true';

    if (debug) {
      const id = (req.headers['x-debug-user-id'] as string | undefined)?.trim();
      if (!id) throw new UnauthorizedException('X-Debug-User-Id header required in debug mode');
      req.userId = id;
      return true;
    }

    // TODO: JWT verification (этап 3).
    throw new UnauthorizedException('Real auth not implemented yet');
  }
}
