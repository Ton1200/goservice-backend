import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { CashPaymentModuleEnabledGuard } from './cash-payment-module-enabled.guard';

describe('CashPaymentModuleEnabledGuard', () => {
  function makeGuard(enabled: boolean) {
    const isEnabled = jest.fn().mockResolvedValue(enabled);
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;
    const guard = new CashPaymentModuleEnabledGuard(platformSettingPort);
    return { guard, isEnabled };
  }

  it('allows the request through when payments.payment-methods.cash.enabled is true', async () => {
    const { guard, isEnabled } = makeGuard(true);

    await expect(guard.canActivate()).resolves.toBe(true);
    expect(isEnabled).toHaveBeenCalledWith(
      'payments.payment-methods.cash.enabled',
    );
  });

  it('throws CASH_PAYMENT_MODULE_DISABLED when the flag is false', async () => {
    const { guard } = makeGuard(false);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'CASH_PAYMENT_MODULE_DISABLED',
    });
  });
});
