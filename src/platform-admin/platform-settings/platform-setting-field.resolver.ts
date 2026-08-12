import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { PlatformSettingModel } from './models/platform-setting.model';

/**
 * THE structural guardrail against ever leaking a decrypted value over
 * GraphQL — see `PlatformSetting`'s own header comment in
 * `prisma/schema.prisma` for the full trade-off this exists to mitigate: a
 * per-row `isEncrypted` flag, instead of a structurally separate
 * encrypted-only model, is exactly the class of thing a future contributor
 * can forget to check correctly.
 *
 * `value`/`maskedPreview` are deliberately NOT plain `@Field()`s on
 * `PlatformSettingModel` (see that class's own comments on `rawValue`/
 * `rawMaskedPreview`) — they are resolved HERE, off `parent.isEncrypted`,
 * independent of whatever `rawValue`/`rawMaskedPreview` the mapping layer
 * (`ListPlatformSettingsService`/`SetPlatformSettingService`, via
 * `toPlatformSettingModel`) happened to populate. Even if a FUTURE bug in
 * either of those accidentally populated `rawValue` with a real decrypted
 * secret for an `isEncrypted: true` row, THIS method still returns `null`
 * for it on the wire — the leak is structurally impossible from here, not
 * just discouraged by convention. See
 * `platform-setting-field.resolver.spec.ts` for the test proving this
 * exact scenario.
 *
 * A `@Resolver()` class — per this codebase's transitive-schema-leak
 * defense (see `PlatformSettingsModule`'s header comment), this MUST be
 * registered directly on `PlatformAdminModule`, never inside the
 * resolver-free `PlatformSettingsModule`, so it is reachable ONLY from the
 * admin schema.
 */
@Resolver(() => PlatformSettingModel)
export class PlatformSettingFieldResolver {
  @ResolveField(() => String, {
    name: 'value',
    nullable: true,
    description:
      'The plain-text stored value. Always null when isEncrypted is true — see maskedPreview instead.',
  })
  value(@Parent() setting: PlatformSettingModel): string | null {
    return setting.isEncrypted ? null : setting.rawValue;
  }

  @ResolveField(() => String, {
    name: 'maskedPreview',
    nullable: true,
    description:
      'A short, non-reversible confirmation of the stored value (e.g. "termina en •••1234"). Always null when isEncrypted is false.',
  })
  maskedPreview(@Parent() setting: PlatformSettingModel): string | null {
    return setting.isEncrypted ? setting.rawMaskedPreview : null;
  }
}
