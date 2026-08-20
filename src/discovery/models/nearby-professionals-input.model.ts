import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CoordinatesInput } from './coordinates-input.model';

export const DEFAULT_SEARCH_RADIUS_KM = 10;
export const MAX_SEARCH_RADIUS_KM = 50;
export const DEFAULT_RESULT_LIMIT = 30;
export const MAX_RESULT_LIMIT = 100;

@InputType()
export class NearbyProfessionalsInput {
  @Field(() => CoordinatesInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinatesInput)
  center?: CoordinatesInput;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_RADIUS_KM)
  radiusKm?: number;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_RESULT_LIMIT)
  limit?: number;
}
