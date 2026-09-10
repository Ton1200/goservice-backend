import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * The "relación de usuarios" every row/detail needs: which `User` (via
 * `CustomerProfile`) owns a given `ServiceRequest`. Deliberately its own
 * small, admin-only type — NOT the consumer-facing `CustomerProfile`
 * `@ObjectType` (`src/profiles/models/customer-profile.model.ts`), which
 * has no `userId`/`email` fields at all (see that class's own header
 * comment on why). This type exists specifically so an admin can identify
 * and act on the owning account (e.g. open it in the Users grid) — never
 * reused on the consumer schema.
 */
@ObjectType('AdminServiceRequestCustomer')
export class AdminServiceRequestCustomerModel {
  /** `CustomerProfile.id`. */
  @Field(() => ID)
  id!: string;

  /** `User.id` — the same id `userAccountDetail(id)` accepts. */
  @Field(() => ID)
  userId!: string;

  @Field()
  email!: string;

  // The customer's real name (nombre / apellido), sourced from the
  // `CustomerProfile` itself — both always present now that they replaced
  // the required `displayName` column.
  @Field()
  firstName!: string;

  @Field()
  lastName!: string;
}
