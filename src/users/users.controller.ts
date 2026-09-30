import { Controller, Get, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import { normalizeUsername, usernameProblem } from './username';
import { AdStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Публичная страница продавца: только то, что и так видно в его объявлениях.
// Почту и телефон не отдаём никогда.
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  // Свободен ли адрес страницы — проверка при вводе в «Личных данных».
  @UseGuards(OptionalJwtAuthGuard)
  @Get('username-available')
  async usernameAvailable(@Req() req: { userId?: string }, @Query('u') raw = '') {
    const u = normalizeUsername(raw);
    const problem = usernameProblem(u);
    if (problem) return { available: false, reason: problem };
    const taken = await this.prisma.userHandle.findUnique({ where: { username: u } });
    if (taken && taken.userId !== req.userId) return { available: false, reason: 'Этот адрес уже занят' };
    return { available: true, username: u };
  }

  // Страница по своему адресу: /u/<username>.
  @Get('by-username/:username')
  async byUsername(@Param('username') raw: string) {
    const handle = await this.prisma.userHandle.findUnique({ where: { username: normalizeUsername(raw) } });
    if (!handle) throw new NotFoundException('User not found');
    return this.profile(handle.userId);
  }

  @Get(':id')
  publicProfile(@Param('id') id: string) {
    return this.profile(id);
  }

  private async profile(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        avatar: true,
        bio: true,
        type: true,
        verified: true,
        rating: true,
        reviewsCount: true,
        homeCityId: true,
        createdAt: true,
        onboardedAt: true,
        blockedAt: true,
        handle: { select: { username: true } }
      }
    });
    if (!user || !user.onboardedAt || user.blockedAt) throw new NotFoundException('User not found');
    const activeAdsCount = await this.prisma.ad.count({
      where: { authorId: id, status: AdStatus.approved }
    });
    const { onboardedAt: _hidden, blockedAt: _blocked, handle, ...rest } = user;
    return { ...rest, username: handle?.username ?? null, activeAdsCount };
  }
}
