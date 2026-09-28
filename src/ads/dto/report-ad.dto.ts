import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const REPORT_REASONS = ['scam', 'spam', 'illegal', 'wrong-category', 'sold', 'other'] as const;

export class ReportAdDto {
  @IsIn(REPORT_REASONS)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
