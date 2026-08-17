import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { UserAccountStatus } from '@prisma/client';
import { UsersRepository } from '../../users/users.repository';
import { accountNotApproved } from '../errors/account-not-approved.error';
import { authenticationRequired } from '../errors/authentication-required.error';

interface RequestWithSession {
  userId?: string;
}

/**
 * Reusable "must have an APPROVED account" guard — for any FUTURE GraphQL
 * mutation/query that should only be reachable once identity verification
 * (or the manual admin review path) has cleared an account. NOT applied to
 * any resolver in this change — there is no consumer yet (Identity
 * Verification's own `startIdentityVerification`/`myIdentityVerificationStatus`
 * are deliberately reachable from `PENDING_APPROVAL`, not `APPROVED` — see
 * `StartIdentityVerificationService`). Built now, alongside the rest of
 * this module, so the first real consumer (e.g. a future "post a
 * ServiceRequest" mutation) can add `@UseGuards(SessionGuard,
 * AccountApprovedGuard)` without re-deriving this check.
 *
 * Must run AFTER `SessionGuard` — `@UseGuards(SessionGuard,
 * AccountApprovedGuard)`, in that order — since it reads `req.userId`,
 * which only `SessionGuard` sets. Mirrors `AdminPermissionsGuard`'s exact
 * "must run after the session guard" convention.
 */
@Injectable()
export class AccountApprovedGuard implements CanActivate {
  constructor(private readonly usersRepository: UsersRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = GqlExecutionContext.create(context).getContext<{
      req: RequestWithSession;
    }>().req;

    if (!req.userId) {
      // Should never happen when paired with `SessionGuard` as documented
      // above — defensive, not a normal path.
      throw authenticationRequired();
    }

    const accountStatus = await this.usersRepository.findAccountStatusById(
      req.userId,
    );
    if (accountStatus !== UserAccountStatus.APPROVED) {
      throw accountNotApproved();
    }

    return true;
  }
}
