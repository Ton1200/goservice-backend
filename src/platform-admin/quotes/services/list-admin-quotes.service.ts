import { Injectable } from '@nestjs/common';
import { QuotesRepository } from '../../../quotes/quotes.repository';
import { AdminQuotesPageModel } from '../models/admin-quotes-page.model';
import { toAdminQuoteModel } from '../models/to-admin-quote-model.util';

const DEFAULT_LIMIT = 50;

/**
 * Same DELIBERATE, DOCUMENTED phase-1 scope boundary as
 * `ListAdminServiceRequestsService`: real pagination (`limit`/`offset`,
 * clamped to a max page size), no server-side filter/sort arguments yet —
 * the admin panel's Tabulator grid fetches one page and does its own
 * client-side filtering/sorting on it.
 */
const MAX_LIMIT = 200;

@Injectable()
export class ListAdminQuotesService {
  constructor(private readonly quotesRepository: QuotesRepository) {}

  async listQuotes(
    limitInput?: number,
    offsetInput?: number,
  ): Promise<AdminQuotesPageModel> {
    const limit = Math.min(Math.max(limitInput ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(offsetInput ?? 0, 0);

    const [rows, totalCount] = await Promise.all([
      this.quotesRepository.findManyForAdmin({ limit, offset }),
      this.quotesRepository.countAllForAdmin(),
    ]);

    const page = new AdminQuotesPageModel();
    page.items = rows.map(toAdminQuoteModel);
    page.totalCount = totalCount;
    page.limit = limit;
    page.offset = offset;
    return page;
  }
}
