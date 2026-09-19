import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

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

  // This Professional's CURRENT payment balance (`LedgerRepository.
  // sumProfessionalBalance`) — net digital credits minus cash commission
  // debt, computed fresh on every read (2026-09-18), not the figure of the
  // ONE job this summary row is about. Can be negative. Shown here (not as
  // its own top-level query) so an admin sees it right next to the job that
  // just changed it, without a second lookup.
  @Field(() => Int)
  balance!: number;
}
