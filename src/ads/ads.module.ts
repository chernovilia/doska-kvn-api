import { Module } from '@nestjs/common';
import { AdsController, MyAdsController } from './ads.controller';
import { AdLifecycleService } from './lifecycle.service';
import { AdsService } from './ads.service';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [AuthModule, UploadsModule],
  controllers: [AdsController, MyAdsController],
  providers: [AdsService, AdLifecycleService],
  exports: [AdsService]
})
export class AdsModule {}
