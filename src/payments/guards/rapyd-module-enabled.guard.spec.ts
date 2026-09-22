import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { RapydModuleEnabledGuard } from './rapyd-module-enabled.guard';

describe('RapydModuleEnabledGuard', () => {
  function makeGuard(enabled: boolean) {
    const isEnabled = jest.fn().mockResolvedValue(enabled);
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;
    const guard = new RapydModuleEnabledGuard(platformSettingPort);
    return { guard, isEnabled };
  }

  it("reads Rapyd's OWN flag (never Mercado Pago's card.enabled) and allows the request when it is true", async () => {
    const { guard, isEnabled } = makeGuard(true);

    await expect(guard.canActivate()).resolves.toBe(true);
    expect(isEnabled).toHaveBeenCalledWith(
      'payments.payment-methods.rapyd.enabled',
    );
    expect(isEnabled).not.toHaveBeenCalledWith(
      'payments.payment-methods.mercadopago.card.enabled',
    );
  });

  it('throws RAPYD_MODULE_DISABLED when the flag is false', async () => {
    const { guard } = makeGuard(false);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'RAPYD_MODULE_DISABLED',
    });
  });
});
