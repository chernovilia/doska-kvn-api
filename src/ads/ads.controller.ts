import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import { AdsService } from './ads.service';
import { ListAdsDto } from './dto/list-ads.dto';
import { CreateAdDto } from './dto/create-ad.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
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

  @Get(':id')
  find(@Param('id') id: string) {
    return this.ads.findById(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateAdDto) {
    return this.ads.create(userId, dto);
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
