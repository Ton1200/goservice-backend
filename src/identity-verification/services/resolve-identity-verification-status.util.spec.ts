import { IdentityVerificationStatus } from '@prisma/client';
import { resolveIdentityVerificationStatus } from './resolve-identity-verification-status.util';

describe('resolveIdentityVerificationStatus', () => {
  it('returns PENDING when documentCheckPassed is null (biometric already true)', () => {
    expect(resolveIdentityVerificationStatus(null, true)).toBe(
      IdentityVerificationStatus.PENDING,
    );
  });

  it('returns PENDING when biometricCheckPassed is null (document already true)', () => {
    expect(resolveIdentityVerificationStatus(true, null)).toBe(
      IdentityVerificationStatus.PENDING,
    );
  });

  it('returns PENDING when both are null', () => {
    expect(resolveIdentityVerificationStatus(null, null)).toBe(
      IdentityVerificationStatus.PENDING,
    );
  });

  it('returns APPROVED when both checks passed', () => {
    expect(resolveIdentityVerificationStatus(true, true)).toBe(
      IdentityVerificationStatus.APPROVED,
    );
  });

  it('returns REJECTED when the document check failed', () => {
    expect(resolveIdentityVerificationStatus(false, true)).toBe(
      IdentityVerificationStatus.REJECTED,
    );
  });

  it('returns REJECTED when the biometric check failed', () => {
    expect(resolveIdentityVerificationStatus(true, false)).toBe(
      IdentityVerificationStatus.REJECTED,
    );
  });

  it('returns REJECTED when both checks failed', () => {
    expect(resolveIdentityVerificationStatus(false, false)).toBe(
      IdentityVerificationStatus.REJECTED,
    );
  });
});
