import { UserAccountStatus } from '@prisma/client';
import { UsersRepository } from '../../users/users.repository';
import { GetMyAccountService } from './get-my-account.service';

describe('GetMyAccountService', () => {
  function makeService(returnValue: UserAccountStatus | null) {
    const findAccountStatusById = jest.fn().mockResolvedValue(returnValue);
    const usersRepository = {
      findAccountStatusById,
    } as unknown as UsersRepository;
    const service = new GetMyAccountService(usersRepository);
    return { service, findAccountStatusById };
  }

  it('delegates to UsersRepository.findAccountStatusById and maps the result to { accountStatus }', async () => {
    const { service, findAccountStatusById } = makeService(
      UserAccountStatus.PENDING_APPROVAL,
    );

    const result = await service.getMyAccount('user-1');

    expect(findAccountStatusById).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({
      accountStatus: UserAccountStatus.PENDING_APPROVAL,
    });
  });

  it('maps every account status through unchanged', async () => {
    const { service } = makeService(UserAccountStatus.APPROVED);

    const result = await service.getMyAccount('user-1');

    expect(result).toEqual({ accountStatus: UserAccountStatus.APPROVED });
  });

  it('throws when the repository resolves null (should never happen for an authenticated session)', async () => {
    const { service } = makeService(null);

    await expect(service.getMyAccount('user-1')).rejects.toThrow();
  });
});
