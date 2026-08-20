import { Field, InputType } from '@nestjs/graphql';
import { IsLatitude, IsLongitude } from 'class-validator';

/** Explicit search centre for `nearbyProfessionals`. */
@InputType()
export class CoordinatesInput {
  @Field()
  @IsLatitude()
  latitude!: number;

  @Field()
  @IsLongitude()
  longitude!: number;
}
