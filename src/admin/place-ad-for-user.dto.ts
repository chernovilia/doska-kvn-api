import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CreateAdDto } from '../ads/dto/create-ad.dto';

// POST /admin/ads/for-user — объявление за пользователя: кто продавец и само объявление.
export class PlaceAdForUserDto {
  // Почту часто вставляют с пробелами и заглавными — нормализуем до проверки
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsIn(['phone', 'chat'])
  contactMethod?: 'phone' | 'chat';

  @ValidateNested()
  @Type(() => CreateAdDto)
  ad!: CreateAdDto;
}
