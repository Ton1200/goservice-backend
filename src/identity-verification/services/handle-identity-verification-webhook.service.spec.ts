import {
  IdentityDocumentType,
  IdentityVerificationStatus,
} from '@prisma/client';
import { UsersRepository } from '../../users/users.repository';
import { DiditIdentityVerificationAdapter } from '../adapters/didit-identity-verification.adapter';
import { IdentityVerificationRepository } from '../identity-verification.repository';
import { HandleIdentityVerificationWebhookService } from './handle-identity-verification-webhook.service';

function buildTranslated(
  overrides?: Partial<{
    providerReference: string;
    documentCheckPassed: boolean | null;
    biometricCheckPassed: boolean | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
  }>,
) {
  return {
    providerReference: 'session-123',
    documentCheckPassed: true,
    biometricCheckPassed: true,
    documentType: IdentityDocumentType.NATIONAL_ID,
    status: 'APPROVED' as const,
    ...overrides,
  };
}

describe('HandleIdentityVerificationWebhookService', () => {
  function buildService(options: {
    translated: ReturnType<typeof buildTranslated>;
    existing: {
      id: string;
      userId: string;
      status: IdentityVerificationStatus;
    } | null;
    updateResultIfPending?: boolean;
    transitionFromPendingApproval?: boolean;
  }) {
    const translateWebhookPayload = jest
      .fn()
      .mockReturnValue(options.translated);
    const diditAdapter = {
      translateWebhookPayload,
    } as unknown as DiditIdentityVerificationAdapter;

    const findById = jest.fn().mockResolvedValue(options.existing);
    const updateResultIfPending = jest
      .fn()
      .mockResolvedValue(options.updateResultIfPending ?? true);
    const identityVerificationRepository = {
      findById,
      updateResultIfPending,
    } as unknown as IdentityVerificationRepository;

    const transitionFromPendingApproval = jest
      .fn()
      .mockResolvedValue(options.transitionFromPendingApproval ?? true);
    const usersRepository = {
      transitionFromPendingApproval,
    } as unknown as UsersRepository;

    const service = new HandleIdentityVerificationWebhookService(
      diditAdapter,
      identityVerificationRepository,
      usersRepository,
    );

    return {
      service,
      findById,
      updateResultIfPending,
      transitionFromPendingApproval,
    };
  }

  it('updates the row and transitions the account to APPROVED on a fully-approved webhook', async () => {
    const { service, updateResultIfPending, transitionFromPendingApproval } =
      buildService({
        translated: buildTranslated({ status: 'APPROVED' }),
        existing: {
          id: 'iv-1',
          userId: 'user-1',
          status: IdentityVerificationStatus.PENDING,
        },
      });

    await service.execute({ vendor_data: 'iv-1' });

    expect(updateResultIfPending).toHaveBeenCalledWith(
      'iv-1',
      expect.objectContaining({ status: 'APPROVED' }),
    );
    expect(transitionFromPendingApproval).toHaveBeenCalledWith(
      'user-1',
      'APPROVED',
    );
  });

  it('transitions the account to REJECTED on a rejected webhook', async () => {
    const { service, transitionFromPendingApproval } = buildService({
      translated: buildTranslated({
        status: 'REJECTED',
        documentCheckPassed: false,
      }),
      existing: {
        id: 'iv-1',
        userId: 'user-1',
        status: IdentityVerificationStatus.PENDING,
      },
    });

    await service.execute({ vendor_data: 'iv-1' });

    expect(transitionFromPendingApproval).toHaveBeenCalledWith(
      'user-1',
      'REJECTED',
    );
  });

  it('does not transition the account on a PENDING (in-progress) webhook', async () => {
    const { service, updateResultIfPending, transitionFromPendingApproval } =
      buildService({
        translated: buildTranslated({
          status: 'PENDING',
          documentCheckPassed: null,
          biometricCheckPassed: null,
        }),
        existing: {
          id: 'iv-1',
          userId: 'user-1',
          status: IdentityVerificationStatus.PENDING,
        },
      });

    await service.execute({ vendor_data: 'iv-1' });

    expect(updateResultIfPending).toHaveBeenCalled();
    expect(transitionFromPendingApproval).not.toHaveBeenCalled();
  });

  it('is a no-op (never throws) when vendor_data does not match any known IdentityVerification', async () => {
    const { service, updateResultIfPending, transitionFromPendingApproval } =
      buildService({
        translated: buildTranslated(),
        existing: null,
      });

    await expect(
      service.execute({ vendor_data: 'unknown-id' }),
    ).resolves.toBeUndefined();
    expect(updateResultIfPending).not.toHaveBeenCalled();
    expect(transitionFromPendingApproval).not.toHaveBeenCalled();
  });

  it('is a no-op when vendor_data is missing from the payload entirely', async () => {
    const { service, findById } = buildService({
      translated: buildTranslated(),
      existing: null,
    });

    await expect(service.execute({})).resolves.toBeUndefined();
    expect(findById).not.toHaveBeenCalled();
  });

  it('is a no-op (duplicate webhook) when the row is already decided, never re-updating or re-transitioning', async () => {
    const { service, updateResultIfPending, transitionFromPendingApproval } =
      buildService({
        translated: buildTranslated({ status: 'APPROVED' }),
        existing: {
          id: 'iv-1',
          userId: 'user-1',
          status: IdentityVerificationStatus.APPROVED,
        },
      });

    await service.execute({ vendor_data: 'iv-1' });

    expect(updateResultIfPending).not.toHaveBeenCalled();
    expect(transitionFromPendingApproval).not.toHaveBeenCalled();
  });

  it('never overwrites a decision an admin already made manually (guarded update returns false)', async () => {
    const { service, transitionFromPendingApproval } = buildService({
      translated: buildTranslated({ status: 'APPROVED' }),
      existing: {
        id: 'iv-1',
        userId: 'user-1',
        status: IdentityVerificationStatus.PENDING,
      },
      updateResultIfPending: false,
    });

    await service.execute({ vendor_data: 'iv-1' });

    // updateResultIfPending returned false (raced/already-decided at the
    // User level) — the account-status transition must never be attempted.
    expect(transitionFromPendingApproval).not.toHaveBeenCalled();
  });
});
