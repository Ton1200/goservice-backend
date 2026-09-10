import { Field, ObjectType } from '@nestjs/graphql';

/**
 * The minimal "who submitted this Quote" identity embedded in
 * `AdminServiceRequestQuoteModel` (the "Cotizaciones" tab of
 * `serviceRequestDetail`, GOS-53 admin follow-up) — deliberately narrower
 * than `AdminQuoteProfessionalModel` (`platform-admin/quotes/models/`, which
 * also carries `id`/`userId` for the Quotes grid's own "open in Users grid"
 * use case): this list is read-only context inside a ServiceRequest's own
 * detail view, not a cross-navigation target, so only the professional's
 * name and `email` are needed here.
 *
 * `firstName`/`lastName` are the person's real name; `displayName` is the
 * optional "nombre comercial" and may be `null`.
 */
@ObjectType('AdminServiceRequestQuoteProfessional')
export class AdminServiceRequestQuoteProfessionalModel {
  @Field()
  firstName!: string;

  @Field()
  lastName!: string;

  @Field(() => String, { nullable: true })
  displayName?: string | null;

  @Field()
  email!: string;
}
