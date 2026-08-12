import { Module } from '@nestjs/common';
import { PlatformSettingPort } from './ports/platform-setting.port';
import { CredentialEncryptionPort } from './ports/credential-encryption.port';
import { PlatformSettingsRepository } from './platform-settings.repository';
import { AesGcmCredentialEncryptionAdapter } from './adapters/aes-gcm-credential-encryption.adapter';
import { PrismaPlatformSettingAdapter } from './adapters/prisma-platform-setting.adapter';

/**
 * Deliberately, load-bearingly RESOLVER-FREE — no
 * `PlatformSettingsResolver`, no `@ObjectType()`/`@InputType()` wired here.
 * Same defense as the two Slice-1/2 modules this one replaces
 * (`FeatureFlagsModule`/`PlatformCredentialsModule` — see their own header
 * comments, preserved in git history, for the confirmed transitive-leak
 * risk this avoids): a module WITH a `@Resolver()` class, imported
 * transitively through a module listed in a `GraphQLModule`'s `include`
 * array, DOES leak that resolver's fields into that schema.
 * `PlatformSettingsResolver`/`PlatformSettingFieldResolver`/
 * `SetPlatformSettingService` are registered directly on
 * `PlatformAdminModule` instead — see `../platform-admin.module.ts`.
 *
 * `PlatformSettingsRepository`/`CredentialEncryptionPort` are also exported
 * (not just `PlatformSettingPort`) so `PlatformAdminModule` can reuse the
 * SAME instances for the admin-only resolver/services, rather than
 * duplicating the repository/encryption wiring. This module is imported by
 * BOTH schemas' DI graphs — `AuthModule` (public `/graphql`, for
 * `PlatformSettingPort` alone) and `PlatformAdminModule` (admin
 * `/admin/graphql`) — which is exactly why it must stay resolver-free.
 */
@Module({
  providers: [
    PlatformSettingsRepository,
    {
      provide: CredentialEncryptionPort,
      useClass: AesGcmCredentialEncryptionAdapter,
    },
    {
      provide: PlatformSettingPort,
      useClass: PrismaPlatformSettingAdapter,
    },
  ],
  exports: [
    PlatformSettingPort,
    PlatformSettingsRepository,
    CredentialEncryptionPort,
  ],
})
export class PlatformSettingsModule {}
