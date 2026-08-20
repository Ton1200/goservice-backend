import { Field, InputType } from '@nestjs/graphql';
import { IsString, MinLength } from 'class-validator';

@InputType()
export class AcceptAdminInviteInput {
  @Field()
  @IsString()
  @MinLength(1)
  token!: string;

  // Same policy as `ResetPasswordInput.newPassword`/`RegisterInput.password`
  // — minimum length only, no separate/stricter password-strength rule
  // invented here either.
  @Field()
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
