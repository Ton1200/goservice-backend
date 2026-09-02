import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { AdminServiceRequestCustomerModel } from '../models/admin-service-request-customer.model';

/**
 * Orchestrates `eligibleServiceRequestCustomers` — the "create ServiceRequest
 * for a customer" picker's data source. Only ever returns Customers whose
 * account is APPROVED (this project's "identity validated" state) — this is
 * a UI convenience, NOT the actual enforcement; `createServiceRequestForCustomer`
 * re-checks server-side regardless of what this returned.
 */
@Injectable()
export class ListEligibleServiceRequestCustomersService {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  async listEligibleCustomers(
    search?: string,
  ): Promise<AdminServiceRequestCustomerModel[]> {
    const rows =
      await this.profilesRepository.findApprovedCustomerProfilesForAdmin(
        search,
      );

    return rows.map((row) => {
      const model = new AdminServiceRequestCustomerModel();
      model.id = row.id;
      model.userId = row.user.id;
      model.email = row.user.email;
      model.firstName = row.firstName;
      model.lastName = row.lastName;
      return model;
    });
  }
}
