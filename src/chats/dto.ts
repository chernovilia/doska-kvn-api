import { IsString, MaxLength, MinLength } from 'class-validator';

export class OpenConversationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  adId!: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
