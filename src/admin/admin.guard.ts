import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * AdminGuard — как JwtAuthGuard, но пропускает только тех, у кого
 * (а) role === 'admin' в БД, либо (б) email в ADMIN_EMAILS env.
 *
 * Список ADMIN_EMAILS через запятую, регистронезависимо.
 * Пример: ADMIN_EMAILS=chernovilia@yahoo.com,other@x.com
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<
      Request & { userId?: string; cookies?: Record<string, string> }
    >();

    const token = req.cookies?.access_token;
    if (!token) throw new UnauthorizedException('No access token');

    let userId: string;
    try {
      userId = (await this.auth.verifyAccessToken(token)).userId;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true }
    });
    if (!user) throw new UnauthorizedException('User not found');

    const isAdminRole = user.role === 'admin' || user.role === 'owner';
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const isAdminEmail = !!user.email && adminEmails.includes(user.email.toLowerCase());

    if (!isAdminRole && !isAdminEmail) {
      throw new ForbiddenException('Not an admin');
    }

    req.userId = user.id;
    return true;
  }
}
