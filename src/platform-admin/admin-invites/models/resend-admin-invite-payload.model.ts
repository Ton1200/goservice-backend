import { Field, ObjectType } from '@nestjs/graphql';

/**
 * `success: false` (never a thrown error) is the expected result when the
 * resend cooldown hasn't elapsed yet — `IssueAdminInviteService.
 * issueForAdminUser`'s own no-op case (`{ issued: false }`), not a failure
 * needing a distinct error code. `resendAdminInvite` still throws a real
 * `DomainException` for the genuine error cases (`ADMIN_USER_NOT_FOUND`,
 * `ADMIN_USER_NOT_INVITED`, `EMAIL_DELIVERY_DISABLED`/`_MISCONFIGURED`).
 */
@ObjectType()
export class ResendAdminInvitePayload {
  @Field()
  success!: boolean;
}
