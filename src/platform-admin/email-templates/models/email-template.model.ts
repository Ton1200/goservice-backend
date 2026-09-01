import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

/**
 * Admin-facing GraphQL type for `emailTemplates`/`updateEmailTemplate`
 * (`/admin/graphql` only). Unlike `PlatformSettingModel`, every field here
 * is safe to return plainly — an `EmailTemplate` row holds no secret/
 * encrypted material, so there is no `PlatformSettingFieldResolver`-style
 * field-resolver guardrail needed.
 */
@ObjectType()
export class EmailTemplateModel {
  @Field(() => ID)
  id!: string;

  @Field()
  key!: string;

  @Field()
  subject!: string;

  @Field()
  htmlBody!: string;

  @Field()
  textBody!: string;

  /** The updating admin's display name, or `null` if never edited since
   * being seeded. */
  @Field(() => String, { nullable: true })
  updatedBy!: string | null;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;
}
