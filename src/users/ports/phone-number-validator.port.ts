/**
 * Abstraction over phone-number validation. GOS-22 assumed "the existing
 * abstraction" but none existed in the repo — this is a new, minimal port
 * with a regex-based adapter (`adapters/regex-phone-number-validator.adapter.ts`).
 * `libphonenumber`-grade validation is explicitly TBD/not authorized; this
 * port exists so a stricter adapter can replace the regex one later without
 * touching `RegisterUserService`.
 */
export abstract class PhoneNumberValidatorPort {
  abstract isValid(countryCode: string, number: string): boolean;
}
