import { LedgerRepository } from '../../ledger/ledger.repository';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ListMyPaymentReceiptsService } from './list-my-payment-receipts.service';

describe('ListMyPaymentReceiptsService', () => {
  function makeService(overrides?: {
    customerProfile?: { id: string } | null;
    professionalProfile?: { id: string } | null;
    rows?: unknown[];
  }) {
    const findCustomerProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.customerProfile === undefined
          ? null
          : overrides.customerProfile,
      );
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? null
          : overrides.professionalProfile,
      );
    const profilesRepository = {
      findCustomerProfileByUserId,
      findProfessionalProfileByUserId,
    } as unknown as ProfilesRepository;

    const findManyForCallerProfiles = jest
      .fn()
      .mockResolvedValue(overrides?.rows ?? []);
    const ledgerRepository = {
      findManyForCallerProfiles,
    } as unknown as LedgerRepository;

    const service = new ListMyPaymentReceiptsService(
      profilesRepository,
      ledgerRepository,
    );

    return { service, findManyForCallerProfiles };
  }

  it('passes both resolved profile ids through when the caller holds both profile types', async () => {
    const { service, findManyForCallerProfiles } = makeService({
      customerProfile: { id: 'customer-1' },
      professionalProfile: { id: 'professional-1' },
    });

    await service.listMyPaymentReceipts('user-1');

    expect(findManyForCallerProfiles).toHaveBeenCalledWith({
      customerProfileId: 'customer-1',
      professionalProfileId: 'professional-1',
    });
  });

  it('passes undefined for whichever profile type the caller lacks', async () => {
    const { service, findManyForCallerProfiles } = makeService({
      customerProfile: { id: 'customer-1' },
      professionalProfile: null,
    });

    await service.listMyPaymentReceipts('user-1');

    expect(findManyForCallerProfiles).toHaveBeenCalledWith({
      customerProfileId: 'customer-1',
      professionalProfileId: undefined,
    });
  });

  it('never throws for a caller with neither profile type — returns whatever the repository returns (empty)', async () => {
    const { service } = makeService();

    await expect(service.listMyPaymentReceipts('user-1')).resolves.toEqual([]);
  });
});
