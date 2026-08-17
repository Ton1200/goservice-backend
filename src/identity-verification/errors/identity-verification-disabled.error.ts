import { DomainException } from '../../common/errors/domain-exception';

const IDENTITY_VERIFICATION_DISABLED_CODE = 'IDENTITY_VERIFICATION_DISABLED';

/**
 * Thrown by `IdentityVerificationProviderRegistry.resolve()` when either the
 * GLOBAL kill switch (`identity.enabled`) or the Didit-specific kill switch
 * (`identity.didit.enabled`) is off — see that class's own header comment
 * for the two checks this backs. Deliberately ONE shared error code for
 * both switches (unlike `socialLoginDisabled`'s per-provider messages) —
 * from the caller's perspective, "the whole feature is off" and "the only
 * provider behind it is off" are the same practical outcome today (a single
 * provider). `message` is parametrized per call site purely for
 * operator-facing clarity in logs/error responses, not to let a client
 * distinguish the two cases structurally (both still resolve to the same
 * `extensions.code`).
 */
export function identityVerificationDisabled(reason: string): DomainException {
  return new DomainException(IDENTITY_VERIFICATION_DISABLED_CODE, reason);
}
