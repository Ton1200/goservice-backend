import { IdentityVerificationRepository } from '../identity-verification.repository';
import { GetMyIdentityVerificationStatusService } from './get-my-identity-verification-status.service';

describe('GetMyIdentityVerificationStatusService', () => {
  it('returns null when the user has never started a verification attempt', async () => {
    const repository = {
      findMostRecentByUserId: jest.fn().mockResolvedValue(null),
    } as unknown as IdentityVerificationRepository;
    const service = new GetMyIdentityVerificationStatusService(repository);

    await expect(
      service.getMyIdentityVerificationStatus('user-1'),
    ).resolves.toBeNull();
  });

  it('maps the most recent row, always with verificationUrl null', async () => {
    const repository = {
      findMostRecentByUserId: jest.fn().mockResolvedValue({
        id: 'iv-1',
        status: 'APPROVED',
        documentCheckPassed: true,
        biometricCheckPassed: true,
      }),
    } as unknown as IdentityVerificationRepository;
    const service = new GetMyIdentityVerificationStatusService(repository);

    await expect(
      service.getMyIdentityVerificationStatus('user-1'),
    ).resolves.toEqual({
      id: 'iv-1',
      status: 'APPROVED',
      documentCheckPassed: true,
      biometricCheckPassed: true,
      verificationUrl: null,
    });
  });
});
