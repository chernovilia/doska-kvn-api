import { IsOptional, Matches } from 'class-validator';

export class ViewAdDto {
  // Случайный id вкладки/браузера из localStorage — чтобы гостя не считать дважды за сутки.
  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{8,64}$/)
  sessionId?: string;
}
