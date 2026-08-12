import { Injectable } from '@nestjs/common';
import { DomainException } from '../../../common/errors/domain-exception';
import { BulkDeleteUserAccountsPayload } from '../models/bulk-delete-user-accounts-payload.model';
import { DeleteUserAccountService } from './delete-user-account.service';

const GENERIC_FAILURE_REASON =
  'Could not delete this user account. Please try again.';

/**
 * Orchestrates `bulkDeleteUserAccounts` (GOS-3x follow-up, hard-delete,
 * 2026-08-11). Applies `DeleteUserAccountService.deleteUserAccount` — the
 * EXACT SAME single-account deletion logic (write one `AdminAuditLog`
 * snapshot row, then permanently erase the `User` row and everything
 * cascading from it) — to each id INDEPENDENTLY, never a new/duplicated
 * deletion mechanism.
 *
 * Deliberately NOT one all-or-nothing `$transaction` spanning the whole
 * batch: each id's own call already opens (and commits/rolls back) its OWN
 * `$transaction` inside `DeleteUserAccountService`, so one bad id
 * (not-found, or any other failure) can never abort or roll back the ids
 * that succeeded. Run concurrently via `Promise.allSettled` — safe because
 * each id's transaction is fully independent of every other id's.
 *
 * Every id's outcome is individually observable in the returned payload —
 * `succeededIds`/`failed` together always account for every input id
 * exactly once. Writes ONE `AdminAuditLog` entry PER successfully deleted
 * user (via the reused service, not a separate aggregate entry for the
 * whole batch) — the audit trail reads identically regardless of whether an
 * admin deleted one account or fifty in one call.
 */
@Injectable()
export class BulkDeleteUserAccountsService {
  constructor(
    private readonly deleteUserAccountService: DeleteUserAccountService,
  ) {}

  async bulkDeleteUserAccounts(
    adminUserId: string,
    ids: string[],
  ): Promise<BulkDeleteUserAccountsPayload> {
    const results = await Promise.allSettled(
      ids.map((id) =>
        this.deleteUserAccountService.deleteUserAccount(adminUserId, id),
      ),
    );

    const succeededIds: string[] = [];
    const failed: { id: string; reason: string }[] = [];

    results.forEach((result, index) => {
      const id = ids[index];
      if (result.status === 'fulfilled') {
        succeededIds.push(id);
        return;
      }
      const error: unknown = result.reason;
      const reason =
        error instanceof DomainException
          ? error.message
          : GENERIC_FAILURE_REASON;
      failed.push({ id, reason });
    });

    return { succeededIds, failed };
  }
}
