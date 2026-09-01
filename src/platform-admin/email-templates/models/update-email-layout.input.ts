import { Field, InputType } from '@nestjs/graphql';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * `@IsString()`/`@IsNotEmpty()`/`@MaxLength()` are load-bearing, not
 * decorative — same confirmed-live `ValidationPipe({ whitelist: true })`
 * gotcha `UpdateEmailTemplateInput`'s own comment documents (see that
 * file).
 *
 * `headerHtml`/`footerHtml` are allowed to be EMPTY-STRING-but-not-omitted
 * (an admin who wants no footer at all still submits `""`, not a missing
 * field) — `@IsNotEmpty()` is deliberately NOT applied here, unlike
 * `UpdateEmailTemplateInput`'s fields: a blank header/footer is a valid,
 * intentional admin choice (e.g. `headerText`/`footerText` are seeded `''`/
 * a short disclaimer respectively — see `prisma/seed.ts`), whereas an empty
 * `EmailTemplate.subject`/`.htmlBody`/`.textBody` would always be a mistake.
 *
 * Max lengths mirror `UpdateEmailTemplateInput`'s own reasoning: `headerHtml`/
 * `footerHtml` (50_000) comfortably fit a table-based header/footer with
 * inline styles; `headerText`/`footerText` (5_000) comfortably fit their
 * plain-text equivalents — both deliberately smaller ceilings than
 * `UpdateEmailTemplateInput`'s (100_000/20_000), since a header/footer is
 * structurally much smaller than a full template body.
 */
@InputType()
export class UpdateEmailLayoutInput {
  @Field()
  @IsString()
  @MaxLength(50_000)
  headerHtml!: string;

  @Field()
  @IsString()
  @MaxLength(50_000)
  footerHtml!: string;

  @Field()
  @IsString()
  @MaxLength(5_000)
  headerText!: string;

  @Field()
  @IsString()
  @MaxLength(5_000)
  footerText!: string;

  /**
   * Uploadable-logo follow-up (2026-08-25) — nullable (`null` clears the
   * logo), same "full-state field, not a partial patch" convention as every
   * other field on this input: the admin panel always resubmits the
   * CURRENT `logoUrl` (unchanged) alongside header/footer edits, and only
   * sends a NEW value right after a successful upload (see
   * `admin-panel/js/emailLayout.js`). `@IsOptional()` here means
   * "`class-validator` skips validation for `null`/`undefined`", not
   * "the field may be omitted to mean 'leave unchanged'" — GraphQL/Nest has
   * no such partial-patch concept for a required-shape input like this one.
   *
   * DELIBERATE DEVIATION from `photoUrl`'s plain `@IsUrl()`
   * (`upsert-customer-profile-input.model.ts`/
   * `upsert-professional-profile-input.model.ts`): `validator.js`'s
   * `isURL` defaults `require_tld: true`, which REJECTS
   * `http://localhost:3000/...` — exactly the shape
   * `LocalDevStorageAdapter.publicUrl` always produces today (see that
   * adapter's own header comment; no real object-storage provider is
   * decided yet). Verified empirically (`isURL` returns `false` for a
   * `localhost` URL with default options, `true` with
   * `require_tld: false`). Without this, `updateEmailLayout` would reject
   * every logo URL this local-dev/test-only storage seam can ever produce,
   * making the whole upload flow untestable end-to-end on this machine. A
   * real object-storage provider's URL (a real domain, e.g. `*.s3.amazonaws.com`)
   * still passes `require_tld: false` just fine — this option only WIDENS
   * what's accepted, it never narrows it.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUrl({ require_tld: false })
  logoUrl?: string | null;
}
