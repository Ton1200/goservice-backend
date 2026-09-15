import { Injectable } from '@nestjs/common';
import { EngagementStatus, Prisma } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { ledgerCommissionMisconfigured } from '../errors/ledger-commission-misconfigured.error';
import { LedgerRepository } from '../ledger.repository';
import { computeCommission } from './compute-commission.util';

const COMMISSION_PERCENT_SETTING_KEY =
  'payments.general-settings.commission.percent';

/**
 * GOS-109 — replaces `CancelEngagementByCustomerService.computeCustomerCancellationCharge`'s
 * former always-`null` stub. Implements DEC-008 points 3-5:
 *
 * - Cancelling while `ACCEPTED` -> **no-op, zero `LedgerEntry` writes**
 *   (`preCancelStatus !== IN_PROGRESS`).
 * - Cancelling while `IN_PROGRESS` -> a charge applies, computed as
 *   `feeAmount = round(quotedPrice * commissionPercent / 100)`, then run
 *   through the SAME `computeCommission` split a completed job's
 *   `CUSTOMER_CHARGE` will one day use (DEC-008 point 5 — "reusing
 *   `computeCommission` rather than a separate rule"): `PLATFORM_COMMISSION`
 *   (`commissionPercent` of the fee) retained by GoService, the remainder
 *   (`PROFESSIONAL_NET_CREDIT`) credited to the Professional.
 *
 * Writes exactly 3 `LedgerEntry` rows in that case — see
 * `LedgerRepository.createCustomerCancellationChargeEntries`'s own header
 * comment for why a pure 2-row commission/net split cannot sum to zero on
 * its own, and `computeCommission`'s own header comment for the rounding
 * rule that guarantees `-feeAmount + commission + net === 0` exactly.
 *
 * `commissionPercent` is read fresh from `PlatformSettingPort` on every call
 * (never cached) and frozen into every entry's own
 * `commissionPercentApplied` — a later admin change to
 * `payments.general-settings.commission.percent` never rewrites a past
 * entry. A missing or
 * unparseable setting fails closed with `ledgerCommissionMisconfigured()`,
 * BEFORE any write is attempted (checked first, no partial writes).
 *
 * Must be called from INSIDE the same `prisma.$transaction` as the
 * `Engagement` ACCEPTED|IN_PROGRESS -> CANCELLED CAS write — a ledger
 * failure must roll back the whole cancellation, same guarantee
 * `EmitEngagementLifecycleSystemMessageService.emit` already has in this
 * call site.
 */
@Injectable()
export class RecordCustomerCancellationChargeService {
  constructor(
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async recordIfApplicable(
    tx: Prisma.TransactionClient,
    params: {
      engagementId: string;
      preCancelStatus: EngagementStatus;
      quotedPrice: number;
      currency: string;
      customerProfileId: string;
      professionalProfileId: string;
    },
  ): Promise<void> {
    if (params.preCancelStatus !== EngagementStatus.IN_PROGRESS) {
      // DEC-008 point 3 — cancelling while still ACCEPTED carries no charge.
      return;
    }

    const rawCommissionPercent = await this.platformSettingPort.getValue(
      COMMISSION_PERCENT_SETTING_KEY,
    );
    const commissionPercent =
      rawCommissionPercent === null ? NaN : Number(rawCommissionPercent);
    if (rawCommissionPercent === null || Number.isNaN(commissionPercent)) {
      throw ledgerCommissionMisconfigured();
    }

    const feeAmount = Math.round(
      (params.quotedPrice * commissionPercent) / 100,
    );
    const { commission, net } = computeCommission(feeAmount, commissionPercent);

    await this.ledgerRepository.createCustomerCancellationChargeEntries(tx, {
      engagementId: params.engagementId,
      currency: params.currency,
      customerProfileId: params.customerProfileId,
      professionalProfileId: params.professionalProfileId,
      feeAmount,
      commissionAmount: commission,
      netAmount: net,
      commissionPercentApplied: commissionPercent,
    });
  }
}
