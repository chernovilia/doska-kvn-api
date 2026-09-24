import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Req,
  Res,
  UseGuards
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';

const cookieDomain = process.env.COOKIE_DOMAIN || undefined;
const cookieSecure = process.env.COOKIE_SECURE !== 'false';

function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  accessTtlSec: number,
  refreshTtlSec: number
) {
  const base = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax' as const,
    domain: cookieDomain
  };
  res.cookie('access_token', accessToken, {
    ...base,
    path: '/',
    maxAge: accessTtlSec * 1000
  });
  res.cookie('refresh_token', refreshToken, {
    ...base,
    // Refresh доступен только на auth-роутах
    path: '/v1/auth',
    maxAge: refreshTtlSec * 1000
  });
}

function clearAuthCookies(res: Response) {
  const base = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax' as const,
    domain: cookieDomain
  };
  res.clearCookie('access_token', { ...base, path: '/' });
  res.clearCookie('refresh_token', { ...base, path: '/v1/auth' });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('email/request')
  @HttpCode(200)
  async requestEmailCode(
    @Body() dto: RequestCodeDto,
    @Req() req: Request,
    @Ip() ip: string
  ) {
    return this.auth.requestEmailCode(dto.email, {
      ip,
      ua: req.headers['user-agent']
    });
  }

  @Post('email/verify')
  @HttpCode(200)
  async verifyEmailCode(
    @Body() dto: VerifyCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string
  ) {
    const result = await this.auth.verifyEmailCode(dto.email, dto.code, {
      ip,
      ua: req.headers['user-agent']
    });
    setAuthCookies(
      res,
      result.accessToken,
      result.refreshToken,
      result.accessTtlSec,
      result.refreshTtlSec
    );
    return { ok: true, user: result.user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
    @Ip() ip: string
  ) {
    const oldToken = req.cookies?.refresh_token;
    if (!oldToken) {
      clearAuthCookies(res);
      return { ok: false, error: 'no_refresh_cookie' };
    }
    try {
      const next = await this.auth.refresh(oldToken, {
        ip,
        ua: req.headers['user-agent']
      });
      setAuthCookies(
        res,
        next.accessToken,
        next.refreshToken,
        next.accessTtlSec,
        next.refreshTtlSec
      );
      return { ok: true };
    } catch {
      clearAuthCookies(res);
      return { ok: false, error: 'refresh_invalid' };
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request & { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: Response
  ) {
    await this.auth.logout(req.cookies?.refresh_token);
    clearAuthCookies(res);
    return { ok: true };
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async me(@CurrentUser() userId: string) {
    return this.auth.me(userId);
  }
}
