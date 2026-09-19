import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { ledgerCommissionMisconfigured } from '../errors/ledger-commission-misconfigured.error';
import { LedgerRepository } from '../ledger.repository';
import { computeCommission } from './compute-commission.util';

const COMMISSION_PERCENT_SETTING_KEY =
  'payments.general-settings.commission.percent';

/**
 * GOS-85 — the first real writer of `LedgerEntryType.CUSTOMER_CHARGE`.
 * Records the 3-row ledger event for an APPROVED digital (card) payment of a
 * whole Engagement: `CUSTOMER_CHARGE` (`-quotedPrice`, the balancing leg),
 * `PLATFORM_COMMISSION` and `PROFESSIONAL_NET_CREDIT`, split with the SAME
 * `computeCommission` rule DEC-008 point 5 already reuses for the cancellation
 * fee — see `LedgerRepository.createDigitalPaymentEntries`'s own header
 * comment for the zero-sum shape, the shared-`createdAt` requirement, and why
 * `PROFESSIONAL_NET_CREDIT` is an accounting record and NOT a real-money
 * transfer to the Professional.
 *
 * Mirrors `RecordCustomerCancellationChargeService` exactly: the commission
 * percentage is read fresh from `PlatformSettingPort` on every call (never
 * cached) and frozen into every row's `commissionPercentApplied`, so a later
 * admin change never rewrites a past entry; a missing or unparseable setting
 * fails closed with `ledgerCommissionMisconfigured()` BEFORE any write is
 * attempted.
 *
 * Must be called from INSIDE the same `prisma.$transaction` that flips the
 * `PaymentAttempt` to APPROVED — a ledger failure must roll the approval
 * back, never leave an APPROVED attempt with no ledger event (or the reverse).
 */
@Injectable()
export class RecordDigitalPaymentService {
  constructor(
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async recordDigitalPayment(
    tx: Prisma.TransactionClient,
    params: {
      engagementId: string;
      quotedPrice: number;
      currency: string;
      customerProfileId: string;
      professionalProfileId: string;
    },
  ): Promise<void> {
    const rawCommissionPercent = await this.platformSettingPort.getValue(
      COMMISSION_PERCENT_SETTING_KEY,
    );
    const commissionPercent =
      rawCommissionPercent === null ? NaN : Number(rawCommissionPercent);
    if (rawCommissionPercent === null || Number.isNaN(commissionPercent)) {
      throw ledgerCommissionMisconfigured(
        "GoService's commission percentage is not configured yet — this payment cannot be recorded.",
      );
    }

    const { commission, net } = computeCommission(
      params.quotedPrice,
      commissionPercent,
    );

    await this.ledgerRepository.createDigitalPaymentEntries(tx, {
      engagementId: params.engagementId,
      currency: params.currency,
      customerProfileId: params.customerProfileId,
      professionalProfileId: params.professionalProfileId,
      chargeAmount: params.quotedPrice,
      commissionAmount: commission,
      netAmount: net,
      commissionPercentApplied: commissionPercent,
    });
  }
}
