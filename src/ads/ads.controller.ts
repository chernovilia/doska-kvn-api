import {
  Body,
  Controller,
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
}
