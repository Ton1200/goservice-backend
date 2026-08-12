import { DomainException } from '../../../common/errors/domain-exception';
import { userAccountNotFound } from '../errors/user-account.errors';
import { DeleteUserAccountService } from './delete-user-account.service';
import { BulkDeleteUserAccountsService } from './bulk-delete-user-accounts.service';

describe('BulkDeleteUserAccountsService', () => {
  function makeService(
    deleteImpl: (adminUserId: string, id: string) => Promise<unknown>,
  ) {
    const deleteUserAccount = jest.fn(deleteImpl);
    const deleteUserAccountService = {
      deleteUserAccount,
    } as unknown as DeleteUserAccountService;
    const service = new BulkDeleteUserAccountsService(deleteUserAccountService);
    return { service, deleteUserAccount };
  }

  it('deletes every id independently, reporting a mix of success/not-found without aborting the batch', async () => {
    const { service, deleteUserAccount } = makeService((_admin, id) => {
      if (id === 'good-1' || id === 'good-2') {
        return Promise.resolve({ success: true });
      }
      if (id === 'missing') {
        return Promise.reject(userAccountNotFound(id));
      }
      return Promise.reject(new Error('unexpected'));
    });

    const result = await service.bulkDeleteUserAccounts('admin-1', [
      'good-1',
      'missing',
      'good-2',
    ]);

    expect(result.succeededIds.sort()).toEqual(['good-1', 'good-2']);
    expect(result.failed).toHaveLength(1);

    const missingFailure = result.failed.find((f) => f.id === 'missing');
    expect(missingFailure?.reason).toContain('No user account exists');
    expect(deleteUserAccount).toHaveBeenCalledTimes(3);
  });

  it('falls back to a generic reason for a non-DomainException failure', async () => {
    const { service } = makeService(() =>
      Promise.reject(new Error('boom, unexpected infra failure')),
    );

    const result = await service.bulkDeleteUserAccounts('admin-1', ['x']);

    expect(result.succeededIds).toEqual([]);
    expect(result.failed).toEqual([
      {
        id: 'x',
        reason: 'Could not delete this user account. Please try again.',
      },
    ]);
  });

  it('returns empty succeededIds/failed for an empty id list, without calling deleteUserAccount', async () => {
    const { service, deleteUserAccount } = makeService(() =>
      Promise.resolve({ success: true }),
    );

    const result = await service.bulkDeleteUserAccounts('admin-1', []);

    expect(result).toEqual({ succeededIds: [], failed: [] });
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it('a bad id never aborts the rest of the batch — every call is issued regardless of another id already having failed', async () => {
    const { service, deleteUserAccount } = makeService((_admin, id) =>
      id === 'bad'
        ? Promise.reject(userAccountNotFound(id))
        : Promise.resolve({ success: true }),
    );

    await service.bulkDeleteUserAccounts('admin-1', [
      'bad',
      'ok-1',
      'ok-2',
      'ok-3',
    ]);

    expect(deleteUserAccount).toHaveBeenCalledTimes(4);
    expect(deleteUserAccount).toHaveBeenCalledWith('admin-1', 'ok-3');
  });

  it('every thrown per-id failure that reaches this service is still a DomainException upstream (sanity check on the fixtures used above)', () => {
    expect(userAccountNotFound('x')).toBeInstanceOf(DomainException);
  });
});
