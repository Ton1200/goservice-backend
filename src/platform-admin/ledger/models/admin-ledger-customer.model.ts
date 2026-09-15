import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * The "relación de usuarios" `adminEngagementPaymentSummaries` needs: which
 * `User` (via `CustomerProfile`) is the Customer party on a given
 * Engagement's payment summary. Deliberately its OWN, small, admin-only
 * type — mirrors `AdminServiceRequestCustomerModel`
 * (`src/platform-admin/service-requests/models/`)/`AdminQuoteProfessionalModel`'s
 * own sibling field-for-field, NOT cross-imported from either (this
 * codebase's established convention: each admin submodule owns its own
 * identity sub-types, even though the shape repeats — confirmed by
 * `AdminServiceRequestCustomerModel`/`AdminQuoteProfessionalModel`/
 * `AdminServiceRequestQuoteProfessionalModel` all being separate,
 * independently-defined types today).
 */
@ObjectType('AdminLedgerCustomer')
export class AdminLedgerCustomerModel {
  /** `CustomerProfile.id`. */
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
}
