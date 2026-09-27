import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChatsService } from './chats.service';
import { OpenConversationDto, SendMessageDto } from './dto';

// Открытый чат опрашивает сервер раз в 5 с, значок непрочитанных — раз в 30 с.
const POLLING = {
  short: { limit: 120, ttl: 60_000 },
  medium: { limit: 3_000, ttl: 60 * 60_000 },
  long: { limit: 30_000, ttl: 24 * 60 * 60_000 }
};

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Post()
  @Throttle({ medium: { limit: 60, ttl: 60 * 60_000 } })
  open(@CurrentUser() userId: string, @Body() dto: OpenConversationDto) {
    return this.chats.open(userId, dto.adId);
  }

  @Get()
  list(@CurrentUser() userId: string) {
    return this.chats.list(userId);
  }

  @Get('unread-count')
  @Throttle(POLLING)
  unreadCount(@CurrentUser() userId: string) {
    return this.chats.unreadCount(userId);
  }

  @Get(':id/messages')
  @Throttle(POLLING)
  messages(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Query('after') after?: string
  ) {
    return this.chats.messages(userId, id, after);
  }

  @Post(':id/messages')
  @Throttle({ short: { limit: 20, ttl: 60_000 }, medium: { limit: 300, ttl: 60 * 60_000 } })
  send(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SendMessageDto
  ) {
    return this.chats.send(userId, id, dto.text);
  }
}
