import { Injectable } from '@nestjs/common';
import { PaymentAttemptRepository } from '../../../payments/payment-attempt.repository';
import { AdminPaymentAttemptsFilterInput } from '../models/admin-payment-attempts-filter-input.model';
import { AdminPaymentAttemptsPageModel } from '../models/admin-payment-attempts-page.model';
import { toAdminPaymentAttemptModel } from '../models/to-admin-payment-attempt-model.util';

const DEFAULT_LIMIT = 50;
// Same DELIBERATE, DOCUMENTED phase-1 scope boundary as
// `ListAdminLedgerEntriesService`/`ListAdminReviewsService`.
const MAX_LIMIT = 200;

/**
 * Orchestrates `Query.adminPaymentAttempts`. Every `PaymentAttempt` ever
 * created, of any method, optionally filtered by `engagementId`/
 * `onlyPending` — never redacted for this audience (see
 * `toAdminPaymentAttemptModel`'s own comment). Replaces the pre-
 * generalization `adminCashPaymentConfirmations` (cash-only).
 */
@Injectable()
export class ListAdminPaymentAttemptsService {
  constructor(
    private readonly paymentAttemptRepository: PaymentAttemptRepository,
  ) {}

  async listPaymentAttempts(
    filter?: AdminPaymentAttemptsFilterInput,
    limitInput?: number,
    offsetInput?: number,
  ): Promise<AdminPaymentAttemptsPageModel> {
    const limit = Math.min(Math.max(limitInput ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(offsetInput ?? 0, 0);

    const repositoryFilter = filter
      ? { engagementId: filter.engagementId, onlyPending: filter.onlyPending }
      : undefined;

    const [rows, totalCount] = await Promise.all([
      this.paymentAttemptRepository.findManyForAdmin(
        repositoryFilter,
        limit,
        offset,
      ),
      this.paymentAttemptRepository.countForAdmin(repositoryFilter),
    ]);

    const page = new AdminPaymentAttemptsPageModel();
    page.items = rows.map(toAdminPaymentAttemptModel);
    page.totalCount = totalCount;
    page.limit = limit;
    page.offset = offset;
    return page;
  }
}
