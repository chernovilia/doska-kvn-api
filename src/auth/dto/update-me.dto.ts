import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches
} from 'class-validator';

// PATCH /v1/me — редактирование своего профиля и онбординг.
// Все поля опциональные: одним запросом можно как онбординг завершить,
// так и точечно поменять один флажок.
export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  homeCityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsString()
  // +79991234567, 89991234567, а также любые разумные телефонные строки —
  // валидацию делаем мягко, чтобы не мешать первому вводу.
  @Matches(/^[\d+()\-\s]{6,20}$/, { message: 'phone: invalid format' })
  phone?: string;

  @IsOptional()
  @IsIn(['phone', 'chat'])
  contactMethod?: 'phone' | 'chat';

  @IsOptional()
  @IsBoolean()
  notifyEmail?: boolean;

  // Клиент шлёт true, чтобы отметить «онбординг пройден» / «согласился с условиями».
  // Сервер сам подставляет DateTime.
  @IsOptional()
  @IsBoolean()
  markOnboarded?: boolean;

  @IsOptional()
  @IsBoolean()
  agreeTerms?: boolean;
}
