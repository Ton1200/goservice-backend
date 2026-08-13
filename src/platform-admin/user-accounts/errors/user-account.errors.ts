import { DomainException } from '../../../common/errors/domain-exception';

const NOT_FOUND_CODE = 'USER_ACCOUNT_NOT_FOUND';
const EMAIL_TAKEN_CODE = 'USER_ACCOUNT_EMAIL_TAKEN';

/**
 * Thrown by `UpdateUserAccountService`/`ForceUserAccountPasswordResetService`/
 * `DeleteUserAccountService` when `id`/`userId` doesn't resolve to a real
 * `User`. UNLIKE the consumer-facing `requestPasswordReset`'s
 * anti-enumeration design, this is safe and correct to surface as a
 * specific, clear error here: this is an internal admin tool, the caller is
 * already authenticated, and the admin only ever reaches this by having
 * selected a row from their own `userAccounts` query result — there is no
 * enumeration risk to protect against.
 */
export function userAccountNotFound(id: string): DomainException {
  return new DomainException(
    NOT_FOUND_CODE,
    `No user account exists with id "${id}".`,
  );
}

/**
 * Thrown by `UpdateUserAccountService` when `input.email` is provided,
 * differs from the account's current email, and already belongs to a
 * DIFFERENT `User` — mirrors `RegisterUserService`'s own
 * `findByEmail`-then-reject pattern. Deliberately specific (not the
 * consumer registration flow's anti-enumeration-generic
 * `REGISTRATION_FAILED`): an authenticated admin editing a known account is
 * not the anti-enumeration-sensitive surface `register` is.
 */
export function userAccountEmailTaken(): DomainException {
  return new DomainException(
    EMAIL_TAKEN_CODE,
    'That email address is already in use by a different user account.',
  );
}
