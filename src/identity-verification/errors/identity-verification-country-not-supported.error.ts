import { CountryCode } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';

const IDENTITY_VERIFICATION_COUNTRY_NOT_SUPPORTED_CODE =
  'IDENTITY_VERIFICATION_COUNTRY_NOT_SUPPORTED';

/**
 * A domain concept kept for a future scenario, but NOT currently thrown by
 * `IdentityVerificationProviderRegistry.resolve()` (simplified 2026-08-15,
 * human-requested — see that class's own header comment): with Didit as
 * the sole provider, every `CountryCode` value resolves to `diditAdapter`
 * once the two global switches (`identity.enabled`/`identity.didit.enabled`)
 * are on — there is no per-country `PlatformSetting` gate left to fail.
 * Reserved for the day `CountryCode` grows a country that genuinely has no
 * adapter at all in the code-level catalog (a code-catalog question, not a
 * config one). Safe to disclose the country back to the caller if/when it
 * IS thrown again: it is THEIR OWN profile's country, resolved
 * server-side, never anything the caller supplied or could probe — this is
 * not an enumeration risk the way, say, `AUTHENTICATION_FAILED`'s
 * anti-enumeration design is.
 */
export function identityVerificationCountryNotSupported(
  country: CountryCode,
): DomainException {
  return new DomainException(
    IDENTITY_VERIFICATION_COUNTRY_NOT_SUPPORTED_CODE,
    `Identity verification is not currently available for country ${country}.`,
  );
}
