import { Injectable } from '@nestjs/common';
import { LedgerRepository } from '../../../ledger/ledger.repository';
import { AdminLedgerEntriesFilterInput } from '../models/admin-ledger-entries-filter-input.model';
import { AdminLedgerEntriesPageModel } from '../models/admin-ledger-entries-page.model';
import { toAdminLedgerEntryModel } from '../models/to-admin-ledger-entry-model.util';

const DEFAULT_LIMIT = 50;
// Same DELIBERATE, DOCUMENTED phase-1 scope boundary as
// `ListAdminReviewsService`/`ListAdminServiceRequestsService`.
const MAX_LIMIT = 200;

/**
 * Orchestrates `Query.adminLedgerEntries`. Every `LedgerEntry` ever written
 * (cancellation-charge/refund events today), optionally filtered by
 * `engagementId`/`professionalProfileId`/`from`/`to` — never redacted for
 * this audience (see `toAdminLedgerEntryModel`'s own comment).
 */
@Injectable()
export class ListAdminLedgerEntriesService {
  constructor(private readonly ledgerRepository: LedgerRepository) {}

  async listLedgerEntries(
    filter?: AdminLedgerEntriesFilterInput,
    limitInput?: number,
    offsetInput?: number,
  ): Promise<AdminLedgerEntriesPageModel> {
    const limit = Math.min(Math.max(limitInput ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(offsetInput ?? 0, 0);

    const repositoryFilter = filter
      ? {
          engagementId: filter.engagementId,
          professionalProfileId: filter.professionalProfileId,
          from: filter.from,
          to: filter.to,
        }
      : undefined;

    const [rows, totalCount] = await Promise.all([
      this.ledgerRepository.findManyForAdmin(repositoryFilter, limit, offset),
      this.ledgerRepository.countForAdmin(repositoryFilter),
    ]);

    const page = new AdminLedgerEntriesPageModel();
    page.items = rows.map(toAdminLedgerEntryModel);
    page.totalCount = totalCount;
    page.limit = limit;
    page.offset = offset;
    return page;
  }
}
