import { Field, Int, ObjectType } from '@nestjs/graphql';

/** `Query.myServiceArea`'s payload — the authenticated Professional's own EXACT Service Area centre + radius. */
@ObjectType()
export class ServiceArea {
  @Field()
  latitude!: number;

  @Field()
  longitude!: number;

  @Field(() => Int)
  radiusKm!: number;
}
