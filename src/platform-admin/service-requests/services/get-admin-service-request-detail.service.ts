import { Injectable } from '@nestjs/common';
import { ServiceRequestsRepository } from '../../../service-requests/service-requests.repository';
import { adminServiceRequestNotFound } from '../errors/admin-service-request.errors';
import { AdminServiceRequestDetailModel } from '../models/admin-service-request-detail.model';
import { toAdminServiceRequestDetailModel } from '../models/to-admin-service-request-model.util';

/**
 * Orchestrates `serviceRequestDetail` (admin panel's Service Requests grid,
 * "View" row action). Gated by the SAME `Permission.SERVICE_REQUESTS_READ`
 * as `serviceRequests` — no new permission for this read-only detail view.
 * Fetches lazily, on demand, never pre-loaded alongside the grid's own
 * lightweight `serviceRequests` page.
 */
@Injectable()
export class GetAdminServiceRequestDetailService {
  constructor(
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
  ) {}

  async getServiceRequestDetail(
    id: string,
  ): Promise<AdminServiceRequestDetailModel> {
    const row = await this.serviceRequestsRepository.findByIdForAdmin(id);
    if (!row) {
      throw adminServiceRequestNotFound(id);
    }
    return toAdminServiceRequestDetailModel(row);
  }
}
