import type { AdminUserAccountRow } from '../../../users/users.repository';
import { UserAccountModel } from './user-account.model';

/**
 * Maps a `UsersRepository.ADMIN_USER_ACCOUNT_SELECT`-shaped row to the
 * GraphQL-facing `UserAccountModel`. `hasCustomerProfile`/
 * `hasProfessionalProfile` are derived here, once, from the presence-only
 * relation selects — never re-derived per call site.
 */
export function toUserAccountModel(row: AdminUserAccountRow): UserAccountModel {
  const model = new UserAccountModel();
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
  return model;
}
