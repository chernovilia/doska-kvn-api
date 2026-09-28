import { Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { FavoritesService } from './favorites.service';

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.favorites.list(userId);
  }

  @Get('ids')
  ids(@CurrentUser() userId: string) {
    return this.favorites.ids(userId);
  }

  @Post(':adId')
  @Throttle({ medium: { limit: 300, ttl: 60 * 60_000 } })
  add(@CurrentUser() userId: string, @Param('adId') adId: string) {
    return this.favorites.add(userId, adId);
  }

  @Delete(':adId')
  @Throttle({ medium: { limit: 300, ttl: 60 * 60_000 } })
  remove(@CurrentUser() userId: string, @Param('adId') adId: string) {
    return this.favorites.remove(userId, adId);
  }
}
