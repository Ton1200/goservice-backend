import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { MercadoPagoSavedCardsEnabledGuard } from './mercadopago-saved-cards-enabled.guard';

const CARD_KEY = 'payments.payment-methods.mercadopago.card.enabled';
const SAVED_CARDS_KEY =
  'payments.payment-methods.mercadopago.card.saved-cards-enabled';

describe('MercadoPagoSavedCardsEnabledGuard', () => {
  function makeGuard(on: string[]) {
    const isEnabled = jest.fn((key: string) =>
      Promise.resolve(on.includes(key)),
    );
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;
    return {
      guard: new MercadoPagoSavedCardsEnabledGuard(platformSettingPort),
      isEnabled,
    };
  }

  it('allows the request only when the Mercado Pago card method AND its saved-cards switch are ON', async () => {
    const { guard } = makeGuard([CARD_KEY, SAVED_CARDS_KEY]);

    await expect(guard.canActivate()).resolves.toBe(true);
  });

  it('throws MERCADOPAGO_SAVED_CARDS_DISABLED when only the saved-cards switch is off (a normal card charge is untouched)', async () => {
    const { guard } = makeGuard([CARD_KEY]);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'MERCADOPAGO_SAVED_CARDS_DISABLED',
    });
  });

  it('throws CARD_PAYMENT_MODULE_DISABLED when the Mercado Pago card method itself is off — saved cards are a feature of the method, so it wins whatever the sub-switch says', async () => {
    const { guard } = makeGuard([SAVED_CARDS_KEY]);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'CARD_PAYMENT_MODULE_DISABLED',
    });
  });

  it("never reads Rapyd's flags", async () => {
    const { guard, isEnabled } = makeGuard([CARD_KEY, SAVED_CARDS_KEY]);

    await guard.canActivate();

    expect(isEnabled).not.toHaveBeenCalledWith(
      'payments.payment-methods.rapyd.enabled',
    );
  });
});
