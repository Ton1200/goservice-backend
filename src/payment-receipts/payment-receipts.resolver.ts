import { UseGuards } from '@nestjs/common';
import { Query, Resolver } from '@nestjs/graphql';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SessionGuard } from '../auth/guards/session.guard';
import { AccountApprovedGuard } from '../identity-verification/guards/account-approved.guard';
import { PaymentReceiptModel } from './models/payment-receipt.model';
import { ListMyPaymentReceiptsService } from './services/list-my-payment-receipts.service';

/**
 * Thin delivery adapter — no business logic here. `myPaymentReceipts`
 * requires only `SessionGuard` + `AccountApprovedGuard` — no
 * module-enabled kill switch (it only reads `LedgerEntry` rows that already
 * exist, same reasoning `myPendingCashCommissionDebt` already establishes).
 * No arguments — always "mine", resolved server-side.
 */
@Resolver()
@UseGuards(SessionGuard, AccountApprovedGuard)
export class PaymentReceiptsResolver {
  constructor(
    private readonly listMyPaymentReceiptsService: ListMyPaymentReceiptsService,
  ) {}

  @Query(() => [PaymentReceiptModel], {
    description:
      "The authenticated User's own payment receipts ('comprobantes') — every LedgerEntry where they are denormalized as either the CustomerProfile or ProfessionalProfile party, most recent first. Always derived from the session — takes no arguments. Returns an empty list, never an error, for a caller with no Engagement history yet.",
  })
  myPaymentReceipts(
    @CurrentUser() userId: string,
  ): Promise<PaymentReceiptModel[]> {
    return this.listMyPaymentReceiptsService.listMyPaymentReceipts(userId);
  }
}
