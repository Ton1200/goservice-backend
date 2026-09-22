import { registerEnumType } from '@nestjs/graphql';

/**
 * `CashPaymentConfirmationState.viewerRole` — which side of the Engagement
 * the calling User actually is, resolved from the Engagement's own
 * `customerProfileId`/`professionalProfileId` (never from an active-role
 * assumption), so a dual-role account always gets the role that matches THIS
 * Engagement. Lets a client tell which of `customerConfirmed`/
 * `professionalConfirmed` is "mine" without inferring it.
 */
export enum CashPaymentViewerRole {
  CUSTOMER = 'CUSTOMER',
  PROFESSIONAL = 'PROFESSIONAL',
}

registerEnumType(CashPaymentViewerRole, {
  name: 'CashPaymentViewerRole',
  description:
    'Which side of the Engagement the calling User is, for this cash-payment confirmation state — CUSTOMER or PROFESSIONAL.',
});
