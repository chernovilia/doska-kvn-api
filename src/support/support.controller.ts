import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupportService } from './support.service';
import { CreateTicketDto, TicketMessageDto } from './dto';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  listMine(@CurrentUser() userId: string) {
    return this.support.listMine(userId);
  }

  @Post()
  @Throttle({ long: { limit: 10, ttl: 24 * 60 * 60_000 } })
  create(@CurrentUser() userId: string, @Body() dto: CreateTicketDto) {
    return this.support.create(userId, dto);
  }

  @Post(':id/messages')
  @Throttle({ medium: { limit: 60, ttl: 60 * 60_000 } })
  addMessage(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: TicketMessageDto) {
    return this.support.addMessage(userId, id, dto.text);
  }
}
