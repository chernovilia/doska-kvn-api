import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.notifications.list(userId);
  }

  // Колокольчик опрашивает раз в минуту.
  @Get('unread-count')
  @Throttle({ short: { limit: 120, ttl: 60_000 } })
  unreadCount(@CurrentUser() userId: string) {
    return this.notifications.unreadCount(userId);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Post(':id/read')
  markRead(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.notifications.markRead(userId, id);
  }
}
