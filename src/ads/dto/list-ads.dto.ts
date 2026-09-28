import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListAdsDto {
  // «Место» — id региона (kvn) или id города (vyksa).
  @IsOptional()
  @IsString()
  place?: string;

  @IsOptional()
  @IsString()
  section?: string;

  // Подгруппа раздела (categoryGroup): «Вакансии», «Резюме», «Легковые»…
  @IsOptional()
  @IsString()
  group?: string;

  @IsOptional()
  @IsString()
  chip?: string;

  // Объявления одного продавца (его публичная страница).
  @IsOptional()
  @IsString()
  authorId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 100;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @IsIn(['recent', 'top', 'cheap', 'expensive'])
  sort?: 'recent' | 'top' | 'cheap' | 'expensive' = 'top';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceMax?: number;
}
