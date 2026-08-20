import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEmail, IsString, IsUUID, MinLength } from 'class-validator';

@InputType()
export class InviteAdminUserInput {
  @Field()
  @IsEmail()
  email!: string;

  @Field()
  @IsString()
  @MinLength(1)
  displayName!: string;

  @Field(() => ID)
  @IsUUID()
  roleId!: string;
}
