import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Deliberately no password-strength validation here (unlike
 * `RegisterInput.password`'s `@MinLength(8)`) — this is a login attempt
 * against an already-created password, not a new-password policy; a
 * non-empty string is the only structural requirement.
 */
@InputType()
export class LoginInput {
  @Field()
  @IsEmail()
  email!: string;

  @Field()
  @IsString()
  @MinLength(1)
  password!: string;
}
