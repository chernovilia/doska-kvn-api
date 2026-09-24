import { IsEmail, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class VerifyCodeDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @Matches(/^\d{6}$/, { message: 'Код должен состоять из 6 цифр' })
  code!: string;
}
