import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAdDto {
  @IsString()
  @MinLength(4)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
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

  @IsOptional()
  @IsString()
  priceSuffix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  avitoUrl?: string;

  // URLs фото, уже загруженных через POST /uploads/ad-photo.
  // Порядок в массиве = порядок отображения в галерее (первое — обложка).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  photoUrls?: string[];
}
