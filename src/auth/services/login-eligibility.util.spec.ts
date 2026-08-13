import { UserAccountStatus } from '@prisma/client';
import { isLoginEligibleStatus } from './login-eligibility.util';

describe('isLoginEligibleStatus', () => {
  it.each([
    UserAccountStatus.EMAIL_VERIFIED,
    UserAccountStatus.PENDING_APPROVAL,
    UserAccountStatus.APPROVED,
  ])('returns true for %s', (status) => {
    expect(isLoginEligibleStatus(status)).toBe(true);
  });

  it.each([
    UserAccountStatus.PENDING_EMAIL_VERIFICATION,
    UserAccountStatus.REJECTED,
  ])('returns false for %s', (status) => {
    expect(isLoginEligibleStatus(status)).toBe(false);
  });
});
