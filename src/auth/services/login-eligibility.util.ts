import { UserAccountStatus } from '@prisma/client';

const LOGIN_ELIGIBLE_STATUSES: ReadonlySet<UserAccountStatus> = new Set([
  UserAccountStatus.EMAIL_VERIFIED,
  UserAccountStatus.APPROVED,
]);

/**
 * Centralizes the login-eligibility rule shared by `LoginService` and
 * `SocialLoginService` (GOS-7) — see the GOS-7 plan's "Reglas de estado de
 * usuario". `PENDING_EMAIL_VERIFICATION` and `REJECTED` are not eligible
 * (a `REJECTED` account never reveals the rejection reason via this path).
 * `PENDING_APPROVAL` is also NOT eligible today: there is no "partial
 * access" concept implemented anywhere in this codebase — this is an open
 * product decision, not resolved here (see the GOS-7 plan's "Decisiones
 * pendientes" #6).
 */
export function isLoginEligibleStatus(status: UserAccountStatus): boolean {
  return LOGIN_ELIGIBLE_STATUSES.has(status);
}
