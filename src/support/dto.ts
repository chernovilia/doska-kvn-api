import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { SUPPORT_TOPICS } from './support.service';

export class CreateTicketDto {
  @IsIn(SUPPORT_TOPICS)
  topic!: string;

  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  text!: string;
}

export class TicketMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;
}
