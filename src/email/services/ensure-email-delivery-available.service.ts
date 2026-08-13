import { Injectable } from '@nestjs/common';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { RESEND_PLATFORM_SETTING_KEYS } from '../constants/resend-settings.constants';
import { emailDeliveryDisabled } from '../errors/email-delivery-disabled.error';
import { emailDeliveryMisconfigured } from '../errors/email-delivery-misconfigured.error';

interface EmailProviderSettingKeys {
  enabledKey: string;
  apiKeyKey: string;
  fromAddressKey: string;
}

/**
 * Every registered email provider this check considers, in priority order.
 * Today only Resend — adding a second provider later (e.g. SendGrid) is a
 * small, contained addition here (one more entry, its own
 * `enabled`/`api-key`/`from-address` keys), not a rewrite: the actual
 * question this service answers is "is ANY configured provider
 * enabled+ready", never hardcoded to "is Resend enabled".
 */
const EMAIL_PROVIDERS: readonly EmailProviderSettingKeys[] = [
  {
    enabledKey: RESEND_PLATFORM_SETTING_KEYS.enabled,
    apiKeyKey: RESEND_PLATFORM_SETTING_KEYS.apiKey,
    fromAddressKey: RESEND_PLATFORM_SETTING_KEYS.fromAddress,
  },
];

/**
 * Upfront, shared availability gate for every mutation that needs to send a
 * real email (`register`, `resendVerificationCode`, `requestPasswordReset`)
 * — mirrors `SocialLoginService`'s
 * `SOCIAL_LOGIN_DISABLED`/`SOCIAL_LOGIN_MISCONFIGURED` pattern exactly (see
 * those errors' own doc comments), applied to email delivery instead of a
 * social-login provider. Callers must call `ensureAvailable()` FIRST,
 * before any other work — see `SocialLoginService.socialLogin`'s own
 * ordering precedent, mirrored exactly by `RegisterUserService.register`,
 * `ResendVerificationCodeService.resendVerificationCode`, and
 * `RequestPasswordResetService.requestPasswordReset`.
 *
 * DELIBERATE DIVERGENCE — read before "simplifying" this: this reads
 * `PlatformSettingPort.getValue()`, never `isEnabled()`. `isEnabled()` is
 * documented FAIL-OPEN on a missing row (resolves to `true`) — correct for
 * the existing social-login feature-gate use case (ops can turn an
 * already-working feature off, without every consumer needing to opt in
 * before a seed has even run), but WRONG here: a never-configured email
 * provider must resolve to "not available", not "available". This service
 * therefore reads the raw value itself and explicitly checks
 * `=== 'true'`, treating `null`/anything else as "not enabled" —
 * FAIL-CLOSED, not fail-open. Do not reuse `isEnabled()` here; doing so
 * would silently invert this safety property.
 *
 * ANTI-ENUMERATION NOTE: this is a GLOBAL, system-wide check — never
 * per-account — so it is safe to run FIRST in every caller, before any
 * account/email lookup, without weakening `RequestPasswordResetService`'s
 * anti-enumeration guarantee. Every caller gets the identical
 * `EMAIL_DELIVERY_DISABLED`/`EMAIL_DELIVERY_MISCONFIGURED` result
 * regardless of which email/account is involved.
 */
@Injectable()
export class EnsureEmailDeliveryAvailableService {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async ensureAvailable(): Promise<void> {
    for (const provider of EMAIL_PROVIDERS) {
      const rawEnabled = await this.platformSettingPort.getValue(
        provider.enabledKey,
      );
      if (rawEnabled !== 'true') {
        // Not this provider's turn — see if another configured provider is
        // enabled instead. Today there is only ever one entry in
        // `EMAIL_PROVIDERS`, so this simply falls through to the final
        // `emailDeliveryDisabled()` throw below.
        continue;
      }

      const [apiKey, fromAddress] = await Promise.all([
        this.platformSettingPort.getValue(provider.apiKeyKey),
        this.platformSettingPort.getValue(provider.fromAddressKey),
      ]);
      if (!apiKey || !fromAddress) {
        throw emailDeliveryMisconfigured();
      }

      return; // Found one enabled AND fully configured provider — done.
    }

    throw emailDeliveryDisabled();
  }
}
