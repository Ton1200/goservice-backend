import { Injectable } from '@nestjs/common';
import { QuotesRepository } from '../../../quotes/quotes.repository';
import { adminQuoteNotFound } from '../errors/admin-quote.errors';
import { AdminQuoteDetailModel } from '../models/admin-quote-detail.model';
import { toAdminQuoteDetailModel } from '../models/to-admin-quote-model.util';

/**
 * Orchestrates `quoteDetail` (admin panel's Quotes grid, "View" row action).
 * Gated by the SAME `Permission.QUOTES_READ` as `quotes` — no new permission
 * for this read-only detail view. Fetches lazily, on demand, never
 * pre-loaded alongside the grid's own lightweight `quotes` page.
 */
@Injectable()
export class GetAdminQuoteDetailService {
  constructor(private readonly quotesRepository: QuotesRepository) {}

  async getQuoteDetail(id: string): Promise<AdminQuoteDetailModel> {
    const row = await this.quotesRepository.findByIdForAdmin(id);
    if (!row) {
      throw adminQuoteNotFound(id);
    }
    return toAdminQuoteDetailModel(row);
  }
}
