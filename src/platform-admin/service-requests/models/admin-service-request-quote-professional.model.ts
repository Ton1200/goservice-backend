import { Field, ObjectType } from '@nestjs/graphql';

/**
 * The minimal "who submitted this Quote" identity embedded in
 * `AdminServiceRequestQuoteModel` (the "Cotizaciones" tab of
 * `serviceRequestDetail`, GOS-53 admin follow-up) — deliberately narrower
 * than `AdminQuoteProfessionalModel` (`platform-admin/quotes/models/`, which
 * also carries `id`/`userId`/`firstName`/`lastName` for the Quotes grid's
 * own "open in Users grid" use case): this list is read-only context inside
 * a ServiceRequest's own detail view, not a cross-navigation target, so only
 * `displayName`/`email` are needed here.
 */
@ObjectType('AdminServiceRequestQuoteProfessional')
export class AdminServiceRequestQuoteProfessionalModel {
  @Field()
  displayName!: string;

  @Field()
  email!: string;
}
