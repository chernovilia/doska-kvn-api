import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { SupportModule } from '../support/support.module';

@Module({
  imports: [AuthModule, UploadsModule, ReviewsModule, SupportModule],
  controllers: [AdminController],
  providers: [AdminGuard]
})
export class AdminModule {}
