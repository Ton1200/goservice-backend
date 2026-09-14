import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LedgerRepository } from '../ledger.repository';

/**
 * GOS-109 — replaces `CancelEngagementByProfessionalService.recordProfessionalCancellationRefund`'s
 * former always-`null` stub. Implements DEC-008's own note that GOS-117 "is
 * unaffected by this DEC" — a Professional-initiated cancellation ALWAYS
 * gets a full refund, no charge, regardless of `preCancelStatus`
 * (`ACCEPTED` or `IN_PROGRESS`).
 *
 * Writes exactly ONE `LedgerEntry` (`REFUND`, positive, the full quoted
 * price) — matches the ticket's literal "un asiento REFUND" wording.
 * Deliberately does NOT call `computeCommission`/`PlatformSettingPort`: this
 * is a plain full refund, not a charge, so there is nothing to split — and
 * it is NOT subject to the zero-sum invariant the 3-row cancellation-charge
 * event is tested against (that invariant is scoped to a real charge; a
 * single, non-split entry has nothing to balance against, since no charge
 * was ever actually collected in this MVP).
 *
 * Must be called from INSIDE the same `prisma.$transaction` as the
 * `Engagement` ACCEPTED|IN_PROGRESS -> CANCELLED CAS write — same
 * "roll back together" guarantee as
 * `RecordCustomerCancellationChargeService.recordIfApplicable`.
 */
@Injectable()
export class RecordProfessionalCancellationRefundService {
  constructor(private readonly ledgerRepository: LedgerRepository) {}

  async record(
    tx: Prisma.TransactionClient,
    params: {
      engagementId: string;
      quotedPrice: number;
      currency: string;
      customerProfileId: string;
    },
  ): Promise<void> {
    await this.ledgerRepository.createRefundEntry(tx, {
      engagementId: params.engagementId,
      currency: params.currency,
      customerProfileId: params.customerProfileId,
      amount: params.quotedPrice,
    });
  }
}
