import { Field, Float, ObjectType } from '@nestjs/graphql';
import { ProfessionalProfile } from '../../profiles/models/professional-profile.model';

/** One `nearbyProfessionals` result — a `ProfessionalProfile` paired with the distance from the search centre. */
@ObjectType()
export class NearbyProfessional {
  @Field(() => ProfessionalProfile)
  profile!: ProfessionalProfile;

  @Field(() => Float)
  distanceKm!: number;
}
