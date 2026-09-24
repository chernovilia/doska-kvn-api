import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController, MeController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { EMAIL_SENDER_TOKEN } from './email-sender.interface';
import { UnisenderGoSender } from './unisender-go.sender';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    JwtAuthGuard,
    {
      provide: EMAIL_SENDER_TOKEN,
      useClass: UnisenderGoSender
    }
  ],
  exports: [AuthService, JwtAuthGuard]
})
export class AuthModule {}
