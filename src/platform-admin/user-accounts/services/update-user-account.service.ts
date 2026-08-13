import { Injectable } from '@nestjs/common';
import { Prisma, UserAccountStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UsersRepository } from '../../../users/users.repository';
import { AuditLogRepository } from '../../audit-log/audit-log.repository';
import {
  userAccountEmailTaken,
  userAccountNotFound,
} from '../errors/user-account.errors';
import { UpdateUserAccountInput } from '../models/update-user-account.input';
import { toUserAccountModel } from '../models/to-user-account-model.util';
import { UserAccountModel } from '../models/user-account.model';

/**
 * Orchestrates `updateUserAccount`: a PARTIAL PATCH (only fields actually
 * present in `input` are considered — see `UpdateUserAccountInput`'s own
 * comment), validates the email-uniqueness case BEFORE writing (mirrors
 * `RegisterUserService`'s `findByEmail`-then-reject pattern), and writes the
 * `User` update AND an `AdminAuditLog` row in the SAME `$transaction` —
 * mirrors `SetPlatformSettingService`'s transaction pattern exactly. This
 * service owns the transaction boundary (injects `PrismaService` directly)
 * for the same reason `SetPlatformSettingService` does: it spans two tables
 * each owned by a different repository (`UsersRepository`,
 * `AuditLogRepository`).
 *
 * EMAIL CHANGE — deliberate, documented behavioral decision: if `email` is
 * provided and differs from the current value, AND is not already taken by
 * a DIFFERENT user, this resets `accountStatus` to
 * `PENDING_EMAIL_VERIFICATION` as part of the SAME update — changing the
 * email address invalidates the prior proof of ownership of the old one.
 * This takes PRIORITY over any `accountStatus` also present in the same
 * input call: an admin cannot simultaneously change the email AND set a
 * different explicit status in one call — the forced
 * `PENDING_EMAIL_VERIFICATION` always wins when both are present. Flagged
 * for reviewer sign-off; may need revisiting if a real workflow needs both
 * at once.
 */
@Injectable()
export class UpdateUserAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersRepository: UsersRepository,
    private readonly auditLogRepository: AuditLogRepository,
  ) {}

  async updateUserAccount(
    adminUserId: string,
    id: string,
    input: UpdateUserAccountInput,
  ): Promise<UserAccountModel> {
    const existing = await this.usersRepository.findByIdForAdmin(id);
    if (!existing) {
      throw userAccountNotFound(id);
    }

    const data: Prisma.UserUpdateInput = {};
    const changedFields: string[] = [];
    const changes: Record<string, { old: unknown; new: unknown }> = {};

    const recordChange = (
      field: string,
      oldValue: unknown,
      newValue: unknown,
    ): void => {
      changedFields.push(field);
      changes[field] = { old: oldValue, new: newValue };
    };

    if (
      input.firstName !== undefined &&
      input.firstName !== existing.firstName
    ) {
      data.firstName = input.firstName;
      recordChange('firstName', existing.firstName, input.firstName);
    }

    if (input.lastName !== undefined && input.lastName !== existing.lastName) {
      data.lastName = input.lastName;
      recordChange('lastName', existing.lastName, input.lastName);
    }

    if (
      input.phoneCountryCode !== undefined &&
      input.phoneCountryCode !== existing.phoneCountryCode
    ) {
      data.phoneCountryCode = input.phoneCountryCode;
      recordChange(
        'phoneCountryCode',
        existing.phoneCountryCode,
        input.phoneCountryCode,
      );
    }

    if (
      input.phoneNumber !== undefined &&
      input.phoneNumber !== existing.phoneNumber
    ) {
      data.phoneNumber = input.phoneNumber;
      recordChange('phoneNumber', existing.phoneNumber, input.phoneNumber);
    }

    let emailChanged = false;
    if (input.email !== undefined && input.email !== existing.email) {
      const owner = await this.usersRepository.findByEmail(input.email);
      if (owner && owner.id !== id) {
        throw userAccountEmailTaken();
      }
      data.email = input.email;
      recordChange('email', existing.email, input.email);
      emailChanged = true;

      if (
        existing.accountStatus !== UserAccountStatus.PENDING_EMAIL_VERIFICATION
      ) {
        data.accountStatus = UserAccountStatus.PENDING_EMAIL_VERIFICATION;
        recordChange(
          'accountStatus',
          existing.accountStatus,
          UserAccountStatus.PENDING_EMAIL_VERIFICATION,
        );
      }
    }

    // Only considered when email did NOT also change this call — see this
    // class's own header comment for why the forced PENDING_EMAIL_VERIFICATION
    // above always takes priority.
    if (
      !emailChanged &&
      input.accountStatus !== undefined &&
      input.accountStatus !== existing.accountStatus
    ) {
      data.accountStatus = input.accountStatus;
      recordChange(
        'accountStatus',
        existing.accountStatus,
        input.accountStatus,
      );
    }

    if (changedFields.length === 0) {
      // Nothing actually differs from the current state — a legitimate
      // no-op (e.g. re-submitting the same value a grid cell already
      // showed). No write, no audit log entry: nothing was updated.
      return toUserAccountModel(existing);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.usersRepository.updateForAdmin(tx, id, data);

      await this.auditLogRepository.write(tx, {
        actorAdminUserId: adminUserId,
        action: 'USER_ACCOUNT_UPDATED',
        targetType: 'User',
        targetKey: id,
        // Old/new NON-SENSITIVE values (name/phone/email/status) — never
        // anything password-related, which this mutation never touches
        // anyway.
        metadata: { changedFields, changes } as Prisma.InputJsonValue,
      });

      return toUserAccountModel(updated);
    });
  }
}
