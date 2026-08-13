import { DomainException } from '../../../common/errors/domain-exception';
import { PlatformSettingValueType } from '@prisma/client';

const REQUIRED_CODE = 'PLATFORM_SETTING_VALUE_REQUIRED';
const INVALID_SHAPE_CODE = 'PLATFORM_SETTING_INVALID_VALUE';
const ENCRYPTED_CANNOT_BE_PUBLIC_CODE =
  'PLATFORM_SETTING_ENCRYPTED_CANNOT_BE_PUBLIC';

/**
 * Thrown by `SetPlatformSettingService.assertValueParses` when `input.value`
 * is empty and this is NOT the one legitimate exception (an update to an
 * already-encrypted setting, submitted empty to mean "don't change it" —
 * see that service's own comment).
 */
export function platformSettingValueRequired(): DomainException {
  return new DomainException(
    REQUIRED_CODE,
    'A value is required to create or update this setting.',
  );
}

/**
 * Thrown when a non-empty `input.value` doesn't parse for the declared
 * `valueType` — e.g. a BOOLEAN setting given anything other than the
 * literal strings `"true"`/`"false"`, or a NUMBER setting given a
 * non-numeric string. Checked BEFORE any encryption/write is attempted.
 */
export function invalidPlatformSettingValue(
  valueType: PlatformSettingValueType,
): DomainException {
  return new DomainException(
    INVALID_SHAPE_CODE,
    `The value provided does not match the declared valueType (${valueType}).`,
  );
}

/**
 * Thrown by `SetPlatformSettingService` when `input.isEncrypted` and
 * `input.isPublic` are BOTH `true` — a hard veto (an encrypted/secret
 * setting can never also be exposed via the unauthenticated `platformConfig`
 * query). Checked and thrown BEFORE any encryption/DB write is attempted,
 * for a clearer error message than the DB CHECK constraint
 * (`platform_setting_encrypted_not_public_check`) would produce on its own
 * — that constraint remains the real, unbypassable backstop; this is
 * defense in depth, not a replacement for it.
 */
export function platformSettingEncryptedCannotBePublic(): DomainException {
  return new DomainException(
    ENCRYPTED_CANNOT_BE_PUBLIC_CODE,
    'An encrypted (secret) setting can never also be marked public — isEncrypted and isPublic cannot both be true.',
  );
}
