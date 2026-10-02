import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

// Глубже лента не листается: дальние страницы дороги для базы, а людям нужны поиск и фильтры.
export const MAX_FEED_OFFSET = 3000;

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

  // Фильтр по характеристикам, JSON: {"transmission":"Автомат","year":{"gte":2015,"lte":2020}}.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  attr?: string;

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
  @Max(MAX_FEED_OFFSET)
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
