import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('me')
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @UseGuards(AuthGuard)
  @Get()
  async me(@CurrentUser() userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { error: 'user not found' };
    return user;
  }
}
