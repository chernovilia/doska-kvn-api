import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto';

@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  // Публично: отзывы о пользователе.
  @Get('users/:id/reviews')
  listFor(@Param('id') id: string) {
    return this.reviews.listFor(id);
  }

  // Можно ли оставить отзыв по диалогу и какой уже оставлен — для кнопки в чате.
  @UseGuards(JwtAuthGuard)
  @Get('conversations/:id/review')
  async eligibility(@CurrentUser() userId: string, @Param('id') id: string) {
    const { eligible, reason, review } = await this.reviews.eligibility(userId, id);
    return { eligible, reason, review };
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ long: { limit: 20, ttl: 24 * 60 * 60_000 } })
  @Post('reviews')
  create(@CurrentUser() userId: string, @Body() dto: CreateReviewDto) {
    return this.reviews.create(userId, dto);
  }
}
