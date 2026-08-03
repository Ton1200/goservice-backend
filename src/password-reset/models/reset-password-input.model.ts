import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

@InputType()
export class ResetPasswordInput {
  @Field()
  @IsEmail()
  email!: string;

  @Field()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits.' })
  code!: string;

  // Same policy as `RegisterInput.password` — minimum length only, no
  // separate/stricter password-strength rule invented for reset (see
  // `src/users/models/register-input.model.ts:34-37` and the GOS-9 plan §8).
  @Field()
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
