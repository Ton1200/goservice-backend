import { Field, InputType } from '@nestjs/graphql';
import { IsEmail, Matches } from 'class-validator';

@InputType()
export class VerifyEmailCodeInput {
  @Field()
  @IsEmail()
  email!: string;

  @Field()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits.' })
  code!: string;
}
