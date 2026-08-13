import { UserAccountStatus } from '@prisma/client';

const LOGIN_ELIGIBLE_STATUSES: ReadonlySet<UserAccountStatus> = new Set([
  UserAccountStatus.EMAIL_VERIFIED,
  UserAccountStatus.PENDING_APPROVAL,
  UserAccountStatus.APPROVED,
]);

/**
 * Centralizes the login-eligibility rule shared by `LoginService` and
 * `SocialLoginService` (GOS-7) — see the GOS-7 plan's "Reglas de estado de
 * usuario". `PENDING_EMAIL_VERIFICATION` and `REJECTED` are the only two
 * non-eligible statuses (a `REJECTED` account never reveals the rejection
 * reason via this path). `PENDING_APPROVAL` accounts CAN log in/browse the
 * app while their identity-document approval is pending — there is no
 * "partial access" concept implemented anywhere in this codebase, so
 * eligibility here is simply "not blocked", not "fully approved" — see
 * goservice-docs/decisions/DEC-006-account-identity-verification.md.
 */
export function isLoginEligibleStatus(status: UserAccountStatus): boolean {
  return LOGIN_ELIGIBLE_STATUSES.has(status);
}
