import { Injectable } from '@nestjs/common';
import { CashPaymentRepository } from '../../../cash-payment/cash-payment.repository';
import { AdminCashPaymentConfirmationsFilterInput } from '../models/admin-cash-payment-confirmations-filter-input.model';
import { AdminCashPaymentConfirmationsPageModel } from '../models/admin-cash-payment-confirmations-page.model';
import { toAdminCashPaymentConfirmationModel } from '../models/to-admin-cash-payment-confirmation-model.util';

const DEFAULT_LIMIT = 50;
// Same DELIBERATE, DOCUMENTED phase-1 scope boundary as
// `ListAdminLedgerEntriesService`/`ListAdminReviewsService`.
const MAX_LIMIT = 200;

/**
 * Orchestrates `Query.adminCashPaymentConfirmations`. Every
 * `CashPaymentConfirmation` ever created, optionally filtered by
 * `engagementId`/`onlyPending` — never redacted for this audience (see
 * `toAdminCashPaymentConfirmationModel`'s own comment).
 */
@Injectable()
export class ListAdminCashPaymentConfirmationsService {
  constructor(private readonly cashPaymentRepository: CashPaymentRepository) {}

  async listCashPaymentConfirmations(
    filter?: AdminCashPaymentConfirmationsFilterInput,
    limitInput?: number,
    offsetInput?: number,
  ): Promise<AdminCashPaymentConfirmationsPageModel> {
    const limit = Math.min(Math.max(limitInput ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(offsetInput ?? 0, 0);

    const repositoryFilter = filter
      ? { engagementId: filter.engagementId, onlyPending: filter.onlyPending }
      : undefined;

    const [rows, totalCount] = await Promise.all([
      this.cashPaymentRepository.findManyForAdmin(
        repositoryFilter,
        limit,
        offset,
      ),
      this.cashPaymentRepository.countForAdmin(repositoryFilter),
    ]);

    const page = new AdminCashPaymentConfirmationsPageModel();
    page.items = rows.map(toAdminCashPaymentConfirmationModel);
    page.totalCount = totalCount;
    page.limit = limit;
    page.offset = offset;
    return page;
  }
}
