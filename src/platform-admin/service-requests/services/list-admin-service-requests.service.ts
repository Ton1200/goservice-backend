import { Injectable } from '@nestjs/common';
import { ServiceRequestsRepository } from '../../../service-requests/service-requests.repository';
import { AdminServiceRequestsPageModel } from '../models/admin-service-requests-page.model';
import { toAdminServiceRequestModel } from '../models/to-admin-service-request-model.util';

const DEFAULT_LIMIT = 50;

/**
 * Same DELIBERATE, DOCUMENTED phase-1 scope boundary as
 * `ListUserAccountsService`: real pagination (`limit`/`offset`, clamped to
 * a max page size), no server-side filter/sort arguments yet — the admin
 * panel's Tabulator grid fetches one page and does its own client-side
 * filtering/sorting on it.
 */
const MAX_LIMIT = 200;

@Injectable()
export class ListAdminServiceRequestsService {
  constructor(
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
  ) {}

  async listServiceRequests(
    limitInput?: number,
    offsetInput?: number,
  ): Promise<AdminServiceRequestsPageModel> {
    const limit = Math.min(Math.max(limitInput ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(offsetInput ?? 0, 0);

    const [rows, totalCount] = await Promise.all([
      this.serviceRequestsRepository.findManyForAdmin({ limit, offset }),
      this.serviceRequestsRepository.countAllForAdmin(),
    ]);

    const page = new AdminServiceRequestsPageModel();
    page.items = rows.map(toAdminServiceRequestModel);
    page.totalCount = totalCount;
    page.limit = limit;
    page.offset = offset;
    return page;
  }
}
