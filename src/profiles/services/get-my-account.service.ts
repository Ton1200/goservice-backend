import { Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '../../users/users.repository';
import { MyAccount } from '../models/my-account.model';

/**
 * Orchestrates `Query.myAccount` — resolves the authenticated user's
 * `accountStatus` via `UsersRepository.findAccountStatusById` (the only
 * class allowed to issue Prisma queries for `User` — see that repository's
 * own header comment) and maps it into the `MyAccount` GraphQL shape.
 * `userId` always comes from `SessionGuard`/`@CurrentUser()` in
 * `ProfilesResolver`, never from a caller-supplied argument, so there is no
 * "whose account" ambiguity for this service to resolve.
 */
@Injectable()
export class GetMyAccountService {
  private readonly logger = new Logger(GetMyAccountService.name);

  constructor(private readonly usersRepository: UsersRepository) {}

  async getMyAccount(userId: string): Promise<MyAccount> {
    const accountStatus =
      await this.usersRepository.findAccountStatusById(userId);

    if (accountStatus === null) {
      // Should never happen for an already-SessionGuard-authenticated
      // caller (the session's userId always maps to a real User row) —
      // logged, not silently swallowed, since it would indicate a real
      // data-integrity problem if it ever did.
      this.logger.warn({ event: 'my_account_user_not_found' });
      throw new Error('User not found for an authenticated session.');
    }

    return { accountStatus };
  }
}
