import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { AdsService } from './ads.service';
import { ListAdsDto } from './dto/list-ads.dto';
import { CreateAdDto } from './dto/create-ad.dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import { ViewAdDto } from './dto/view-ad.dto';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('ads')
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get()
  list(@Query() q: ListAdsDto) {
    return this.ads.list(q);
  }

  @Get('counts')
  counts(@Query('place') place?: string) {
    return this.ads.countsBySection(place);
  }

  @Get('sitemap')
  sitemap() {
    return this.ads.sitemapEntries();
  }

  @Get(':id')
  find(@Param('id') id: string) {
    return this.ads.findById(id);
  }

  // Просмотр страницы объявления. Один раз в сутки на пользователя / браузер / IP.
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':id/view')
  view(
    @Req() req: Request & { userId?: string },
    @Param('id') id: string,
    @Body() dto: ViewAdDto
  ) {
    const ip = (req.headers['cf-connecting-ip'] as string) || req.ip || '';
    // Гость без localStorage (приватный режим) — по хэшу IP, сам IP не храним.
    const sessionId =
      dto.sessionId || 'ip-' + createHash('sha256').update(ip).digest('hex').slice(0, 24);
    return this.ads.registerView(id, { userId: req.userId, sessionId });
  }

  // Rate-limit создания: 5 объявлений в час, 20 в сутки (антиспам).
  @UseGuards(JwtAuthGuard)
  @Throttle({
    medium: { limit: 5, ttl: 60 * 60_000 },
    long: { limit: 20, ttl: 24 * 60 * 60_000 }
  })
  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateAdDto) {
    return this.ads.create(userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ medium: { limit: 30, ttl: 60 * 60_000 } })
  @Get(':id/contact')
  contact(@Param('id') id: string) {
    return this.ads.contact(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/bump')
  bump(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.ads.bump(userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.ads.removeOwn(userId, id);
  }
}

// GET /v1/me/ads — свои объявления (все статусы).
// Отдельный контроллер, чтобы префикс URL был /me/*, а не /ads/*.
@Controller('me/ads')
@UseGuards(JwtAuthGuard)
export class MyAdsController {
  constructor(private readonly ads: AdsService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.ads.listMine(userId);
  }
}
