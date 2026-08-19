import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * `displayOrder` defaults to `0` when omitted (`CreateCategoryService`) —
 * ties are allowed and resolved alphabetically by `name`, so a brand-new
 * category with no explicit order just sorts among its siblings by name
 * until an admin reorders it. `parentId` omitted/`null` means "root-level
 * category" — the common case.
 */
@InputType()
export class CreateCategoryInput {
  @Field()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}
