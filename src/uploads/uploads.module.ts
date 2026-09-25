import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { S3ClientService } from './s3.client';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController],
  providers: [S3ClientService],
  exports: [S3ClientService]
})
export class UploadsModule {}
