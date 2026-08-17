import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { UserAccountStatus } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { UsersRepository } from '../../users/users.repository';
import { AccountApprovedGuard } from './account-approved.guard';

function buildContext(userId: string | undefined): ExecutionContext {
  const req = { userId };
  jest
    .spyOn(GqlExecutionContext, 'create')
    .mockReturnValue({ getContext: () => ({ req }) } as never);
  return {} as ExecutionContext;
}

describe('AccountApprovedGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('allows an APPROVED account through', async () => {
    const findAccountStatusById = jest
      .fn()
      .mockResolvedValue(UserAccountStatus.APPROVED);
    const usersRepository = {
      findAccountStatusById,
    } as unknown as UsersRepository;
    const guard = new AccountApprovedGuard(usersRepository);

    await expect(guard.canActivate(buildContext('user-1'))).resolves.toBe(true);
  });

  it.each([
    UserAccountStatus.PENDING_EMAIL_VERIFICATION,
    UserAccountStatus.EMAIL_VERIFIED,
    UserAccountStatus.PENDING_APPROVAL,
    UserAccountStatus.REJECTED,
  ])('rejects a %s account with ACCOUNT_NOT_APPROVED', async (status) => {
    const findAccountStatusById = jest.fn().mockResolvedValue(status);
    const usersRepository = {
      findAccountStatusById,
    } as unknown as UsersRepository;
    const guard = new AccountApprovedGuard(usersRepository);

    await expect(
      guard.canActivate(buildContext('user-1')),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: 'ACCOUNT_NOT_APPROVED',
    });
  });

  it('rejects with UNAUTHENTICATED when no userId is present on the request', async () => {
    const findAccountStatusById = jest.fn();
    const usersRepository = {
      findAccountStatusById,
    } as unknown as UsersRepository;
    const guard = new AccountApprovedGuard(usersRepository);

    await expect(
      guard.canActivate(buildContext(undefined)),
    ).rejects.toMatchObject<Partial<DomainException>>({
      code: 'UNAUTHENTICATED',
    });
    expect(findAccountStatusById).not.toHaveBeenCalled();
  });
});
