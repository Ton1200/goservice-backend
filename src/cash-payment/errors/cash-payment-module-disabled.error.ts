import { DomainException } from '../../common/errors/domain-exception';

const CASH_PAYMENT_MODULE_DISABLED_CODE = 'CASH_PAYMENT_MODULE_DISABLED';

/**
 * Thrown by `CashPaymentModuleEnabledGuard` when the
 * `payments.payment-methods.cash.enabled` `PlatformSetting` currently
 * resolves to `false` — the GLOBAL kill switch
 * for the whole Cash Payment capability (`confirmCashPayment` only —
 * `myPendingCashCommissionDebt` is a read of already-existing data and is
 * NOT gated by this switch, see that guard's own header comment). Applied to
 * `confirmCashPayment` alone in `CashPaymentResolver`, same "one guard, the
 * mutation(s) it protects" convention as `AppointmentsModuleEnabledGuard`/
 * `QuoteNegotiationModuleEnabledGuard`.
 */
export function cashPaymentModuleDisabled(): DomainException {
  return new DomainException(
    CASH_PAYMENT_MODULE_DISABLED_CODE,
    'Cash Payment is currently disabled.',
  );
}
