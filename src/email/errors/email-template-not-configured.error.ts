import { DomainException } from '../../common/errors/domain-exception';

const EMAIL_TEMPLATE_NOT_CONFIGURED_CODE = 'EMAIL_TEMPLATE_NOT_CONFIGURED';

/**
 * Thrown by every sender adapter
 * (`EmailQueueVerificationCodeSenderAdapter`/
 * `EmailQueuePasswordResetEmailSenderAdapter`/
 * `EmailQueueAdminInviteEmailSenderAdapter`) when
 * `EmailTemplatePort.getByKey(key)` returns `null` — i.e. `prisma/seed.ts`
 * hasn't run yet on this environment, or the row was somehow deleted
 * outside the normal `updateEmailTemplate` mutation (which only ever
 * UPDATES, never deletes, one of the 3 fixed rows — see `EmailTemplate`'s
 * own header comment in `prisma/schema.prisma`).
 *
 * Mirrors `emailDeliveryMisconfigured()`'s exact shape and fail-closed
 * philosophy: never silently send a broken/empty email built from a `null`
 * template — fail loudly instead, with a code distinct from
 * `EMAIL_DELIVERY_MISCONFIGURED`/`EMAIL_DELIVERY_DISABLED` (this is a
 * content-configuration problem, not a provider-availability one — the two
 * are checked independently and can fail for different reasons).
 */
export function emailTemplateNotConfigured(key: string): DomainException {
  return new DomainException(
    EMAIL_TEMPLATE_NOT_CONFIGURED_CODE,
    `Email template "${key}" is not configured yet.`,
  );
}
