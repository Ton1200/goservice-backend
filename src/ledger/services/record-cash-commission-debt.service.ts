import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { ledgerCommissionMisconfigured } from '../errors/ledger-commission-misconfigured.error';
import { LedgerRepository } from '../ledger.repository';
import { computeCommission } from './compute-commission.util';

const COMMISSION_PERCENT_SETTING_KEY =
  'payments.general-settings.commission.percent';

/**
 * GOS-87 — writes the single `CASH_COMMISSION_DEBT` `LedgerEntry` the instant
 * BOTH parties confirm cash payment for the same Engagement
 * (`ConfirmCashPaymentService`, only after its own guarded CAS on
 * `CashPaymentConfirmation.commissionDebtRecorded` wins the race — see that
 * service's own header comment).
 *
 * Reuses the SAME `payments.general-settings.commission.percent`
 * `PlatformSetting` and the
 * SAME `computeCommission` split rule `RecordCustomerCancellationChargeService`
 * already established (DEC-008) — the amount owed is simply
 * `computeCommission(quotedPrice, commissionPercent).commission`, the
 * platform's cut of a job whose FULL price the Professional already
 * collected in cash, outside GoService. Unlike the cancellation-charge
 * event, there is no balancing/net-credit leg to write: nothing here was
 * ever charged through GoService, so there is nothing else to split.
 *
 * `commissionPercent` is read fresh from `PlatformSettingPort` on every call
 * (never cached) and frozen into the entry's own `commissionPercentApplied`
 * — a later admin change to `payments.general-settings.commission.percent`
 * never rewrites a
 * past entry. A missing or unparseable setting fails closed with
 * `ledgerCommissionMisconfigured()`, BEFORE any write is attempted.
 *
 * Must be called from INSIDE the same `prisma.$transaction` as the
 * `CashPaymentConfirmation` CAS write that decided this call should record
 * the debt — a ledger-write failure must roll back that whole confirmation,
 * same guarantee `RecordCustomerCancellationChargeService` already has for
 * its own caller.
 */
@Injectable()
export class RecordCashCommissionDebtService {
  constructor(
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly ledgerRepository: LedgerRepository,
  ) {}

  async recordCommissionDebt(
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
      throw ledgerCommissionMisconfigured();
    }

    const { commission } = computeCommission(
      params.quotedPrice,
      commissionPercent,
    );

    await this.ledgerRepository.createCashCommissionDebtEntry(tx, {
      engagementId: params.engagementId,
      currency: params.currency,
      customerProfileId: params.customerProfileId,
      professionalProfileId: params.professionalProfileId,
      amount: commission,
      commissionPercentApplied: commissionPercent,
    });
  }
}
