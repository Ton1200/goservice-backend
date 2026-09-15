import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * The Professional-side mirror of `AdminLedgerCustomerModel` — see that
 * class's own header comment for the full "why its own type" rationale.
 */
@ObjectType('AdminLedgerProfessional')
export class AdminLedgerProfessionalModel {
  /** `ProfessionalProfile.id`. */
  @Field(() => ID)
  id!: string;

  /** `User.id` — the same id `userAccountDetail(id)` accepts. */
  @Field(() => ID)
  userId!: string;

  @Field()
  email!: string;

  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  // Optional public "nombre comercial" — may be `null`.
  @Field(() => String, { nullable: true })
  displayName?: string | null;
}
