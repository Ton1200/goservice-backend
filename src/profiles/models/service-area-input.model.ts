import { Field, InputType, Int } from '@nestjs/graphql';
import { IsInt, IsLatitude, IsLongitude, Max, Min } from 'class-validator';

/** Exact centre + radius a Professional declares as their Service Area (ADR 0006 / DEC-005). */
@InputType()
export class ServiceAreaInput {
  @Field()
  @IsLatitude()
  latitude!: number;

  @Field()
  @IsLongitude()
  longitude!: number;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(100)
  radiusKm!: number;
}
