import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { MercadoPagoWalletModuleEnabledGuard } from './mercadopago-wallet-module-enabled.guard';

describe('MercadoPagoWalletModuleEnabledGuard', () => {
  function makeGuard(enabled: boolean) {
    const isEnabled = jest.fn().mockResolvedValue(enabled);
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;
    const guard = new MercadoPagoWalletModuleEnabledGuard(platformSettingPort);
    return { guard, isEnabled };
  }

  it('allows the request through when payments.payment-methods.mercadopago.wallet.enabled is true', async () => {
    const { guard, isEnabled } = makeGuard(true);

    await expect(guard.canActivate()).resolves.toBe(true);
    expect(isEnabled).toHaveBeenCalledWith(
      'payments.payment-methods.mercadopago.wallet.enabled',
    );
  });

  it('throws MERCADOPAGO_WALLET_MODULE_DISABLED when the flag is false', async () => {
    const { guard } = makeGuard(false);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'MERCADOPAGO_WALLET_MODULE_DISABLED',
    });
  });
});
