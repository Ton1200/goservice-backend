import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * The "relación de usuarios" every Quotes admin grid row/detail needs: which
 * `User` (via `ProfessionalProfile`) submitted a given `Quote`. Deliberately
 * its own small, admin-only type — NOT the consumer-facing `ProfessionalProfile`
 * `@ObjectType` (`src/profiles/models/professional-profile.model.ts`), which
 * has no `userId`/`email` fields at all (same rationale as that class's own
 * header comment, and the same reasoning
 * `AdminServiceRequestCustomerModel` already documents for `CustomerProfile`
 * on the Service Requests admin grid). This type exists specifically so an
 * admin can identify and act on the submitting Professional's account (e.g.
 * open it in the Users grid) — never reused on the consumer schema.
 */
@ObjectType('AdminQuoteProfessional')
export class AdminQuoteProfessionalModel {
  /** `ProfessionalProfile.id`. */
  @Field(() => ID)
  id!: string;

  /** `User.id` — the same id `userAccountDetail(id)` accepts. */
  @Field(() => ID)
  userId!: string;

  @Field()
  email!: string;

  // The professional's real name (nombre / apellido), sourced from the
  // `ProfessionalProfile` itself — both always present.
  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  // Optional public "nombre comercial" — may be `null`.
  @Field(() => String, { nullable: true })
  displayName?: string | null;
}
