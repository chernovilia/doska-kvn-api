import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class RegionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('regions')
  async regions() {
    return this.prisma.region.findMany({
      orderBy: { launched: 'desc' },
      include: { cities: true }
    });
  }

  @Get('cities')
  async cities() {
    return this.prisma.city.findMany({ orderBy: { name: 'asc' } });
  }
}
