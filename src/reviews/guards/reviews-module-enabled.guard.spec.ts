import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { ReviewsModuleEnabledGuard } from './reviews-module-enabled.guard';

describe('ReviewsModuleEnabledGuard', () => {
  function makeGuard(enabled: boolean) {
    const isEnabled = jest.fn().mockResolvedValue(enabled);
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;
    const guard = new ReviewsModuleEnabledGuard(platformSettingPort);
    return { guard, isEnabled };
  }

  it('allows the request through when reviews.rating.enabled is true', async () => {
    const { guard, isEnabled } = makeGuard(true);

    await expect(guard.canActivate()).resolves.toBe(true);
    expect(isEnabled).toHaveBeenCalledWith('reviews.rating.enabled');
  });

  it('throws REVIEWS_MODULE_DISABLED when the flag is false', async () => {
    const { guard } = makeGuard(false);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'REVIEWS_MODULE_DISABLED',
    });
  });
});
