import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PwaController } from './pwa.controller';

@Module({
  imports: [AuthModule],
  controllers: [PwaController]
})
export class PwaModule {}
