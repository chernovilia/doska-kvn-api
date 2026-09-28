import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AuthModule } from '../auth/auth.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ReviewsModule } from '../reviews/reviews.module';

@Module({
  imports: [AuthModule, UploadsModule, ReviewsModule],
  controllers: [AdminController],
  providers: [AdminGuard]
})
export class AdminModule {}
