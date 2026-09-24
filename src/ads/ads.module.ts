import { Module } from '@nestjs/common';
import { AdsController, MyAdsController } from './ads.controller';
import { AdsService } from './ads.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AdsController, MyAdsController],
  providers: [AdsService]
})
export class AdsModule {}
