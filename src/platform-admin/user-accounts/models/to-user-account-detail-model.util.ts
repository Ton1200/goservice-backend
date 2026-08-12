import type { AdminUserAccountDetailRow } from '../../../users/users.repository';
import { UserAccountDetailModel } from './user-account-detail.model';

/**
 * Maps a `UsersRepository.ADMIN_USER_ACCOUNT_DETAIL_SELECT`-shaped row to
 * the GraphQL-facing `UserAccountDetailModel` — the `userAccountDetail`
 * counterpart of `to-user-account-model.util.ts`'s `toUserAccountModel`.
 * `customerProfile`/`professionalProfile` are assigned straight through:
 * each Prisma row is a structural SUPERSET of its corresponding GraphQL
 * class (e.g. `CustomerProfile`'s Prisma row also carries `userId`, which
 * `src/profiles/models/customer-profile.model.ts` deliberately has no
 * `@Field` for) — the exact same "extra properties are harmless, GraphQL
 * only ever reads the fields it's decorated to resolve" pattern
 * `GetMyCustomerProfileService`/`GetMyProfessionalProfileService` already
 * rely on, applied here instead of re-constructing a new plain object by
 * hand.
 */
export function toUserAccountDetailModel(
  row: AdminUserAccountDetailRow,
): UserAccountDetailModel {
  const model = new UserAccountDetailModel();
  model.id = row.id;
  model.firstName = row.firstName;
  model.lastName = row.lastName;
  model.email = row.email;
  model.phoneCountryCode = row.phoneCountryCode;
  model.phoneNumber = row.phoneNumber;
  model.accountStatus = row.accountStatus;
  model.authProvider = row.authProvider;
  model.createdAt = row.createdAt;
  model.updatedAt = row.updatedAt;
  model.hasCustomerProfile = row.customerProfile !== null;
  model.hasProfessionalProfile = row.professionalProfile !== null;
  model.customerProfile = row.customerProfile;
  model.professionalProfile = row.professionalProfile;
  return model;
}
