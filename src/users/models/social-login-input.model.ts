import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsString, MinLength } from 'class-validator';
import { SocialProvider } from '../enums/social-provider.enum';

@InputType()
export class SocialLoginInput {
  @Field(() => SocialProvider)
  @IsEnum(SocialProvider)
  provider!: SocialProvider;

  @Field()
  @IsString()
  @MinLength(1)
  identityToken!: string;
}
