import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'crypto';
import { validGid } from '../guest-id';
import { Throttle } from '@nestjs/throttler';
import { AdsService } from './ads.service';
import { ListAdsDto } from './dto/list-ads.dto';
import { CreateAdDto } from './dto/create-ad.dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import { ViewAdDto } from './dto/view-ad.dto';
import { ReportAdDto } from './dto/report-ad.dto';
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

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  find(@Param('id') id: string, @Req() req: Request & { userId?: string }) {
    return this.ads.findById(id, req.userId);
  }

  // Просмотр страницы объявления. Один раз в сутки на пользователя / браузер.
  @UseGuards(OptionalJwtAuthGuard)
  @Post(':id/view')
  view(
    @Req() req: Request & { userId?: string },
    @Param('id') id: string,
    @Body() dto: ViewAdDto
  ) {
    // Гость без localStorage (приватный режим) — по cookie гостя gid (IP за прокси Amvera у всех один).
    const gid = validGid(req.cookies?.gid) || 'none';
    const sessionId =
      dto.sessionId || 'g-' + createHash('sha256').update(gid).digest('hex').slice(0, 24);
    return this.ads.registerView(id, { userId: req.userId, sessionId });
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ long: { limit: 20, ttl: 24 * 60 * 60_000 } })
  @Post(':id/report')
  report(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: ReportAdDto) {
    return this.ads.report(userId, id, dto);
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

  // Правка своего объявления — те же поля, что при подаче; модерация как при подаче.
  @UseGuards(JwtAuthGuard)
  @Throttle({ medium: { limit: 30, ttl: 60 * 60_000 } })
  @Put(':id')
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: CreateAdDto) {
    return this.ads.update(userId, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/auto-bump')
  autoBump(@CurrentUser() userId: string, @Param('id') id: string, @Body() body: { enabled?: boolean }) {
    return this.ads.setAutoBump(userId, id, body?.enabled === true);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/archive')
  archive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.ads.archiveOwn(userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/renew')
  renew(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.ads.renewOwn(userId, id);
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
