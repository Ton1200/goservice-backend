import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';
import { PlatformSettingValueType } from './platform-setting-value-type.enum';

/**
 * Admin-facing GraphQL type for `platformSettings`/`setPlatformSetting`
 * (`/admin/graphql` only). `value`/`maskedPreview` are DELIBERATELY NOT
 * declared as plain `@Field()`s here — see `rawValue`/`rawMaskedPreview`'s
 * own comments below, and `../platform-setting-field.resolver.ts` (the
 * class that actually resolves those two fields on the wire) for the full
 * guardrail this split exists to enforce. This is the load-bearing defense
 * against the exact risk a per-row `isEncrypted` flag (instead of a
 * structurally separate encrypted-only model) implies — see
 * `PlatformSetting`'s own header comment in `prisma/schema.prisma`.
 */
@ObjectType()
export class PlatformSettingModel {
  @Field(() => ID)
  id!: string;

  @Field()
  key!: string;

  @Field()
  description!: string;

  @Field(() => PlatformSettingValueType)
  valueType!: PlatformSettingValueType;

  @Field()
  isEncrypted!: boolean;

  /**
   * Whether this setting is exposed via the unauthenticated, consumer-facing
   * `platformConfig` query (`/graphql`) — independent of `isEncrypted`; see
   * that field's own comment above and `PlatformSetting`'s own header
   * comment in `prisma/schema.prisma`. Never `true` at the same time as
   * `isEncrypted` (structurally impossible to persist — see the
   * `platform_setting_encrypted_not_public_check` DB CHECK constraint).
   * Plain `@Field()`, unlike `value`/`maskedPreview` below — `isPublic`
   * itself is never sensitive, so it needs no field-resolver guardrail.
   */
  @Field()
  isPublic!: boolean;

  /** Only meaningful when `isEncrypted` is true; `null` otherwise. */
  @Field(() => String, { nullable: true })
  provider!: string | null;

  /** The updating admin's display name, or `null` if never set. */
  @Field(() => String, { nullable: true })
  updatedBy!: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  /**
   * NOT exposed via `@Field()`. Carries the raw, non-encrypted stored
   * `value` (from `PlatformSetting.value`) — or `null` for an encrypted
   * row, or a row whose value hasn't been set. The actual `value` field on
   * the wire is resolved by `PlatformSettingFieldResolver.value()`, which
   * independently re-checks `isEncrypted` before ever returning this,
   * rather than trusting whichever service populated this object to have
   * gotten that branch right. Deliberately public (not `private`) so this
   * class stays a plain data-transfer shape — the guardrail is enforced by
   * WHERE this value is read from (the field resolver), not by TypeScript
   * visibility.
   */
  rawValue!: string | null;

  /**
   * NOT exposed via `@Field()` — same reasoning as `rawValue` above.
   * Carries the raw `maskedPreview` (from `PlatformSetting.maskedPreview`)
   * for an encrypted row, or `null` otherwise. Resolved on the wire by
   * `PlatformSettingFieldResolver.maskedPreview()`.
   */
  rawMaskedPreview!: string | null;
}
