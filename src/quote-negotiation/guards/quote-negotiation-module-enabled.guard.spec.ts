import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { QuoteNegotiationModuleEnabledGuard } from './quote-negotiation-module-enabled.guard';

describe('QuoteNegotiationModuleEnabledGuard', () => {
  function makeGuard(enabled: boolean) {
    const isEnabled = jest.fn().mockResolvedValue(enabled);
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;
    const guard = new QuoteNegotiationModuleEnabledGuard(platformSettingPort);
    return { guard, isEnabled };
  }

  it('allows the request through when quote-negotiation.general.enabled is true — applies uniformly to every one of the 4 gated operations, since this guard is applied at the resolver class level (postQuoteNegotiationMessage/acceptQuotePriceProposal/rejectQuotePriceProposal/quoteNegotiationMessages all share this ONE guard instance)', async () => {
    const { guard, isEnabled } = makeGuard(true);

    await expect(guard.canActivate()).resolves.toBe(true);
    expect(isEnabled).toHaveBeenCalledWith('quote-negotiation.general.enabled');
  });

  it('throws QUOTE_NEGOTIATION_MODULE_DISABLED when the flag is false — blocks all 4 operations, since none of them can execute without this guard passing first', async () => {
    const { guard } = makeGuard(false);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'QUOTE_NEGOTIATION_MODULE_DISABLED',
    });
  });
});
