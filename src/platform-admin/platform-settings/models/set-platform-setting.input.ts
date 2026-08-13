import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { PlatformSettingValueType } from './platform-setting-value-type.enum';

@InputType()
export class SetPlatformSettingInput {
  @Field()
  @IsString()
  @MinLength(1)
  key!: string;

  @Field()
  @IsString()
  @MinLength(1)
  description!: string;

  // `@IsEnum` is load-bearing, not decorative: `ValidationPipe`'s
  // `whitelist: true` (see main.ts) strips/rejects any DTO property with
  // ZERO class-validator decorators as "should not exist" — confirmed live,
  // every `setPlatformSetting` call failed with exactly that error before
  // this was added, despite `@Field()` alone being enough for the GraphQL
  // schema itself to accept the input shape.
  @Field(() => PlatformSettingValueType)
  @IsEnum(PlatformSettingValueType)
  valueType!: PlatformSettingValueType;

  @Field()
  @IsBoolean()
  isEncrypted!: boolean;

  /**
   * Independent of `isEncrypted` — answers "should this be exposed via the
   * unauthenticated `platformConfig` query?" rather than "is this a
   * secret?". Same requiredness convention as `isEncrypted` above: this
   * mutation expects the FULL desired state of a row on every call, not a
   * partial patch — there is no "leave isPublic unchanged" semantic.
   * `SetPlatformSettingService` rejects `isEncrypted: true` combined with
   * `isPublic: true` BEFORE any DB write is attempted (a hard veto, also
   * enforced structurally by a DB CHECK constraint as the real backstop —
   * see that service's own comment).
   */
  @Field()
  @IsBoolean()
  isPublic!: boolean;

  /**
   * The real value, in plaintext, over the wire — same trust boundary as a
   * password over HTTPS. `SetPlatformSettingService` encrypts it
   * immediately when `isEncrypted` is true; never persisted or logged in
   * this form either way.
   *
   * Deliberately NOT `@MinLength(1)` — an EMPTY string is a legitimate,
   * meaningful input here: submitting empty on an UPDATE to an
   * already-encrypted setting means "don't change it" (mirrors the former
   * `PlatformCredential` write-only UX rule). `SetPlatformSettingService`
   * itself rejects an empty value in every other case (a fresh/non-encrypted
   * setting, or a BOOLEAN/NUMBER whose parsed shape it validates).
   */
  @Field()
  @IsString()
  value!: string;

  /**
   * Only meaningful when `isEncrypted` is true — optional otherwise. NOT
   * used by the Google/Apple `client-id` settings as of 2026-08-09: an
   * OAuth client-id is a public identifier, not a secret, so those are now
   * plain, non-encrypted STRING settings (see `admin-panel/js/settings.js`'s
   * `KNOWN_SETTING_SLOTS`) — this field remains for whatever future setting
   * genuinely IS encrypted.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  provider?: string;
}
