import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { RapydSavedCardsEnabledGuard } from './rapyd-saved-cards-enabled.guard';

const RAPYD_KEY = 'payments.payment-methods.rapyd.enabled';
const SAVED_CARDS_KEY = 'payments.payment-methods.rapyd.saved-cards-enabled';

describe('RapydSavedCardsEnabledGuard', () => {
  function makeGuard(on: string[]) {
    const isEnabled = jest.fn((key: string) =>
      Promise.resolve(on.includes(key)),
    );
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;
    return {
      guard: new RapydSavedCardsEnabledGuard(platformSettingPort),
      isEnabled,
    };
  }

  it('allows the request only when Rapyd AND its saved-cards switch are ON', async () => {
    const { guard } = makeGuard([RAPYD_KEY, SAVED_CARDS_KEY]);

    await expect(guard.canActivate()).resolves.toBe(true);
  });

  it('throws RAPYD_SAVED_CARDS_DISABLED when only the saved-cards switch is off (Rapyd checkout is untouched)', async () => {
    const { guard } = makeGuard([RAPYD_KEY]);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'RAPYD_SAVED_CARDS_DISABLED',
    });
  });

  it('throws RAPYD_MODULE_DISABLED when Rapyd itself is off — saved cards are a feature of the method, so it wins whatever the sub-switch says', async () => {
    const { guard } = makeGuard([SAVED_CARDS_KEY]);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'RAPYD_MODULE_DISABLED',
    });
  });

  it("never reads Mercado Pago's flags", async () => {
    const { guard, isEnabled } = makeGuard([RAPYD_KEY, SAVED_CARDS_KEY]);

    await guard.canActivate();

    expect(isEnabled).not.toHaveBeenCalledWith(
      'payments.payment-methods.mercadopago.card.enabled',
    );
  });
});
