import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';
import { Type } from 'class-transformer';
import { SECTION_IDS } from '../sections';

export class CreateAdDto {
  @IsString()
  @MinLength(4)
  @MaxLength(200)
  title!: string;

  @IsIn(SECTION_IDS)
  section!: string;

  @IsString()
  cityId!: string;

  @IsOptional()
  @IsString()
  categoryGroup?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  price?: number = 0;

  // Верхняя граница: «зарплата до» у вакансий.
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  priceTo?: number;

  @IsOptional()
  @IsString()
  priceSuffix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  address?: string;

  // Характеристики раздела. Форму значений проверяет AdsService.sanitizeAttributes.
  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  // Дата и время события (Афиша).
  @IsOptional()
  @IsISO8601()
  eventDate?: string;



  // URLs фото, уже загруженных через POST /uploads/ad-photo.
  // Порядок в массиве = порядок отображения в галерее (первое — обложка).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  photoUrls?: string[];
}
