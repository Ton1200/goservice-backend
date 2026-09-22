import { engagementNotFound } from '../../engagement-chat/errors/engagement-not-found.error';
import { PaymentAttemptRepository } from '../../payments/payment-attempt.repository';
import { CashPaymentAccessService } from '../cash-payment-access.service';
import { GetMyCashPaymentConfirmationService } from './get-my-cash-payment-confirmation.service';

describe('GetMyCashPaymentConfirmationService', () => {
  function makeService(overrides: {
    role?: 'CUSTOMER' | 'PROFESSIONAL';
    notParty?: boolean;
    row?: {
      customerConfirmedAt: Date | null;
      professionalConfirmedAt: Date | null;
    } | null;
  }) {
    const resolveParty = overrides.notParty
      ? jest.fn().mockRejectedValue(engagementNotFound())
      : jest.fn().mockResolvedValue({ role: overrides.role ?? 'CUSTOMER' });
    const findCashAttemptByEngagementId = jest
      .fn()
      .mockResolvedValue(overrides.row ?? null);
    const service = new GetMyCashPaymentConfirmationService(
      { resolveParty } as unknown as CashPaymentAccessService,
      {
        findCashAttemptByEngagementId,
      } as unknown as PaymentAttemptRepository,
    );
    return { service, resolveParty, findCashAttemptByEngagementId };
  }

  const NOW = new Date('2026-09-18T10:00:00.000Z');

  it('no row yet: all three flags are false and viewerRole reflects the caller’s role', async () => {
    const { service } = makeService({ role: 'PROFESSIONAL', row: null });

    await expect(
      service.getMyCashPaymentConfirmation('user-1', 'eng-1'),
    ).resolves.toEqual({
      engagementId: 'eng-1',
      viewerRole: 'PROFESSIONAL',
      customerConfirmed: false,
      professionalConfirmed: false,
      bothConfirmed: false,
    });
  });

  it('only the Customer confirmed', async () => {
    const { service } = makeService({
      role: 'PROFESSIONAL',
      row: { customerConfirmedAt: NOW, professionalConfirmedAt: null },
    });

    await expect(
      service.getMyCashPaymentConfirmation('user-1', 'eng-1'),
    ).resolves.toMatchObject({
      customerConfirmed: true,
      professionalConfirmed: false,
      bothConfirmed: false,
    });
  });

  it('only the Professional confirmed', async () => {
    const { service } = makeService({
      role: 'CUSTOMER',
      row: { customerConfirmedAt: null, professionalConfirmedAt: NOW },
    });

    await expect(
      service.getMyCashPaymentConfirmation('user-1', 'eng-1'),
    ).resolves.toMatchObject({
      viewerRole: 'CUSTOMER',
      customerConfirmed: false,
      professionalConfirmed: true,
      bothConfirmed: false,
    });
  });

  it('both confirmed: bothConfirmed is true', async () => {
    const { service } = makeService({
      row: { customerConfirmedAt: NOW, professionalConfirmedAt: NOW },
    });

    await expect(
      service.getMyCashPaymentConfirmation('user-1', 'eng-1'),
    ).resolves.toMatchObject({
      customerConfirmed: true,
      professionalConfirmed: true,
      bothConfirmed: true,
    });
  });

  it('a non-party gets ENGAGEMENT_NOT_FOUND and the confirmation row is never read', async () => {
    const { service, findCashAttemptByEngagementId } = makeService({
      notParty: true,
    });

    await expect(
      service.getMyCashPaymentConfirmation('user-x', 'eng-1'),
    ).rejects.toMatchObject({ code: 'ENGAGEMENT_NOT_FOUND' });
    expect(findCashAttemptByEngagementId).not.toHaveBeenCalled();
  });
});
