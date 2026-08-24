import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { EngagementChatModuleEnabledGuard } from './engagement-chat-module-enabled.guard';

describe('EngagementChatModuleEnabledGuard', () => {
  function makeGuard(enabled: boolean) {
    const isEnabled = jest.fn().mockResolvedValue(enabled);
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;
    const guard = new EngagementChatModuleEnabledGuard(platformSettingPort);
    return { guard, isEnabled };
  }

  it('allows the request through when customer.chat.enabled is true — applies uniformly to both gated operations, since this guard is applied at the resolver class level (sendEngagementMessage/engagementMessages share this ONE guard instance)', async () => {
    const { guard, isEnabled } = makeGuard(true);

    await expect(guard.canActivate()).resolves.toBe(true);
    expect(isEnabled).toHaveBeenCalledWith('customer.chat.enabled');
  });

  it('throws ENGAGEMENT_CHAT_MODULE_DISABLED when the flag is false — blocks both operations, since neither can execute without this guard passing first', async () => {
    const { guard } = makeGuard(false);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'ENGAGEMENT_CHAT_MODULE_DISABLED',
    });
  });
});
