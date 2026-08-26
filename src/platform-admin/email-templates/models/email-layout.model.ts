import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

/**
 * Admin-facing GraphQL type for `emailLayout`/`updateEmailLayout`
 * (`/admin/graphql` only). Mirrors `EmailTemplateModel` exactly — every
 * field here is safe to return plainly, an `EmailLayout` row holds no
 * secret/encrypted material.
 */
@ObjectType()
export class EmailLayoutModel {
  @Field(() => ID)
  id!: string;

  @Field()
  headerHtml!: string;

  @Field()
  footerHtml!: string;

  @Field()
  headerText!: string;

  @Field()
  footerText!: string;

  /** Uploadable-logo follow-up (2026-08-25) — `null` means no logo is
   * currently configured. Referenced from `headerHtml`/`footerHtml` via the
   * same `{{logoUrl}}` token mechanism every other layout variable already
   * uses — see `EmailTemplateRenderer`'s own header comment. */
  @Field(() => String, { nullable: true })
  logoUrl!: string | null;

  /** The updating admin's display name, or `null` if never edited since
   * being seeded. */
  @Field(() => String, { nullable: true })
  updatedBy!: string | null;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
