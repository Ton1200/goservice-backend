import { DomainException } from '../../../common/errors/domain-exception';

/**
 * Thrown by `GetEmailLayoutService` when no `EmailLayout` row exists yet —
 * i.e. `prisma/seed.ts` hasn't run on this environment. In ordinary
 * operation this never happens (the seed always creates the `'singleton'`
 * row — see `prisma/seed.ts`), but `emailLayout: EmailLayoutModel!` is a
 * non-nullable GraphQL field, so a missing row must fail loudly rather than
 * return `null`/a made-up default — same "pre-check, then friendly error"
 * convention `emailTemplateRowNotSeeded` already establishes for the
 * analogous `EmailTemplate` case. `updateEmailLayout` never hits this: its
 * own `EmailLayoutRepository.upsert` creates the row on first use instead of
 * requiring it to pre-exist (see that repository's own header comment).
 */
export function emailLayoutRowNotSeeded(): DomainException {
  return new DomainException(
    'EMAIL_LAYOUT_ROW_NOT_SEEDED',
    'The shared email header/footer layout has not been seeded yet on this environment.',
  );
}

/**
 * Thrown by `RequestEmailLogoUploadUrlService` when `input.contentType`
 * isn't one of this feature's small allow-list
 * (`ALLOWED_EMAIL_LOGO_CONTENT_TYPES`) — mirrors
 * `unsupportedAttachmentContentType()`
 * (`src/service-requests/errors/unsupported-attachment-content-type.error.ts`)
 * exactly, just a distinct code for this distinct feature/allow-list (no
 * `application/pdf` here — a logo is always an image).
 */
export function unsupportedEmailLogoContentType(): DomainException {
  return new DomainException(
    'UNSUPPORTED_EMAIL_LOGO_CONTENT_TYPE',
    'Unsupported email logo content type.',
  );
}
