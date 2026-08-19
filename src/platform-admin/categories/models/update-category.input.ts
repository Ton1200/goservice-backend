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
 * ALL fields optional — a PARTIAL PATCH, same convention as
 * `UpdateUserAccountInput`: only fields ACTUALLY PRESENT in the input are
 * considered by `UpdateCategoryService`; an unset field is left untouched.
 *
 * `parentId` is the one field where "unset" and "explicitly null" mean two
 * DIFFERENT things, and GraphQL lets the client express both:
 *   - omitted entirely → `undefined` server-side → parent left untouched.
 *   - explicitly sent `null` → moves the Category to root level (clears
 *     its parent).
 *   - a real id → re-parents it (after `UpdateCategoryService` re-validates
 *     existence and cycle-safety — never trust the value on its own).
 * `class-validator`'s `@IsOptional()` skips remaining validators for BOTH
 * `undefined` and `null`, which is exactly right here: `null` needs no
 * `@IsUUID()` check, it's not an id at all.
 */
@InputType()
export class UpdateCategoryInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}
