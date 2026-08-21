import { Injectable } from '@nestjs/common';
import { CountryCode } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { DiditIdentityVerificationAdapter } from '../adapters/didit-identity-verification.adapter';
import { IDENTITY_PLATFORM_SETTING_KEYS } from '../constants/didit-settings.constants';
import { identityVerificationDisabled } from '../errors/identity-verification-disabled.error';
import { IdentityVerificationPort } from '../ports/identity-verification.port';

/**
 * Resolves WHICH `IdentityVerificationPort` implementation handles a given
 * `country`. Kept as its own class (Port -> Registry -> Adapter), not
 * collapsed into a direct call, for the same two concrete reasons the
 * implementation plan gives: (1) it's the same shape already used twice in
 * this backend (`SocialIdentityValidationPort`/`EmailClientPort`'s own
 * gating), and (2) a second provider later is then a new adapter + one more
 * branch here, not a domain/resolver rewrite.
 *
 * Simplified (2026-08-15, human-requested): there is no longer any
 * per-country `identity.routing.<country>.enabled` `PlatformSetting` gate.
 * Didit is the SOLE provider and its own hosted workflow already covers
 * every country GoService's `CountryCode` enum currently models (`AR`/`CO`)
 * — a separate country-by-country kill switch on top of that added no real
 * value, only extra admin-panel ceremony. The gating is now exactly TWO
 * global switches: `identity.enabled` (the whole capability) and
 * `identity.didit.enabled` (the Didit provider specifically). Once both are
 * on, EVERY `CountryCode` value resolves to `diditAdapter` — `country` is
 * still accepted as a parameter (call sites already resolve it
 * server-side — see `StartIdentityVerificationService`) purely so this
 * signature doesn't need to change again the day a SECOND provider is
 * introduced and this method needs to actually branch on `country` to pick
 * between adapters.
 *
 * `IDENTITY_VERIFICATION_COUNTRY_NOT_SUPPORTED`
 * (`identity-verification-country-not-supported.error.ts`) is kept as a
 * domain concept but is NOT thrown anywhere in this class today — it's
 * reserved for the day `CountryCode` grows a country that genuinely has no
 * adapter at all in the code-level catalog (not a config/PlatformSetting
 * question anymore, a code-catalog one).
 *
 * Both checks read `PlatformSettingPort.isEnabled()` LIVE, on every call —
 * never cached — same "resolved live, per-call" discipline as
 * `SocialLoginService`'s own `FEATURE_FLAG_KEY_BY_PROVIDER` reads.
 * `isEnabled()` is documented FAIL-OPEN on a missing row (see that port's
 * own doc comment) — the SAME trade-off `SocialLoginService` already
 * accepts for its own kill switches, deliberately NOT the fail-closed
 * `EnsureEmailDeliveryAvailableService` pattern: `prisma/seed.ts` seeds both
 * of these boolean rows explicitly (`'false'` by default — see that file's
 * own comment), so "missing row" is not actually a reachable state in a
 * seeded environment; fail-open here would only matter for an
 * unseeded/corrupted database, the same edge case `SocialLoginService`
 * already tolerates identically.
 */
@Injectable()
export class IdentityVerificationProviderRegistry {
  constructor(
    private readonly diditAdapter: DiditIdentityVerificationAdapter,
    private readonly platformSettingPort: PlatformSettingPort,
  ) {}

  async resolve(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    country: CountryCode,
  ): Promise<IdentityVerificationPort> {
    const globallyEnabled = await this.platformSettingPort.isEnabled(
      IDENTITY_PLATFORM_SETTING_KEYS.enabled,
    );
    if (!globallyEnabled) {
      throw identityVerificationDisabled(
        'Identity verification is currently disabled.',
      );
    }

    const diditEnabled = await this.platformSettingPort.isEnabled(
      IDENTITY_PLATFORM_SETTING_KEYS.diditEnabled,
    );
    if (!diditEnabled) {
      throw identityVerificationDisabled(
        'The Didit identity verification provider is currently disabled.',
      );
    }

    return this.diditAdapter;
  }
}
