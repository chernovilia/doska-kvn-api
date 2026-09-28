import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { AdStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Публичная страница продавца: только то, что и так видно в его объявлениях.
// Почту и телефон не отдаём никогда.
@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id')
  async publicProfile(@Param('id') id: string) {
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
        blockedAt: true
      }
    });
    if (!user || !user.onboardedAt || user.blockedAt) throw new NotFoundException('User not found');
    const activeAdsCount = await this.prisma.ad.count({
      where: { authorId: id, status: AdStatus.approved }
    });
    const { onboardedAt: _hidden, blockedAt: _blocked, ...rest } = user;
    return { ...rest, activeAdsCount };
  }
}
