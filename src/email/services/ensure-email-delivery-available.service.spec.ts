import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { RESEND_PLATFORM_SETTING_KEYS } from '../constants/resend-settings.constants';
import { EnsureEmailDeliveryAvailableService } from './ensure-email-delivery-available.service';

describe('EnsureEmailDeliveryAvailableService', () => {
  function makeService(values: Record<string, string | null>) {
    const getValue = jest.fn((key: string) =>
      Promise.resolve(values[key] ?? null),
    );
    const platformSettingPort = { getValue } as unknown as PlatformSettingPort;
    const service = new EnsureEmailDeliveryAvailableService(
      platformSettingPort,
    );
    return { service, getValue };
  }

  it('resolves without throwing when the provider is enabled and fully configured', async () => {
    const { service } = makeService({
      [RESEND_PLATFORM_SETTING_KEYS.enabled]: 'true',
      [RESEND_PLATFORM_SETTING_KEYS.apiKey]: 're_live_abc',
      [RESEND_PLATFORM_SETTING_KEYS.fromAddress]: 'noreply@example.com',
    });

    await expect(service.ensureAvailable()).resolves.toBeUndefined();
  });

  it('throws EMAIL_DELIVERY_DISABLED when the enabled row is missing entirely', async () => {
    const { service } = makeService({});

    await expect(service.ensureAvailable()).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_DISABLED',
    });
  });

  it('throws EMAIL_DELIVERY_DISABLED when the enabled value is anything other than the literal "true"', async () => {
    const { service } = makeService({
      [RESEND_PLATFORM_SETTING_KEYS.enabled]: 'false',
      [RESEND_PLATFORM_SETTING_KEYS.apiKey]: 're_live_abc',
      [RESEND_PLATFORM_SETTING_KEYS.fromAddress]: 'noreply@example.com',
    });

    await expect(service.ensureAvailable()).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_DISABLED',
    });
  });

  it('throws EMAIL_DELIVERY_MISCONFIGURED when enabled but the api-key is missing', async () => {
    const { service } = makeService({
      [RESEND_PLATFORM_SETTING_KEYS.enabled]: 'true',
      [RESEND_PLATFORM_SETTING_KEYS.fromAddress]: 'noreply@example.com',
    });

    await expect(service.ensureAvailable()).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_MISCONFIGURED',
    });
  });

  it('throws EMAIL_DELIVERY_MISCONFIGURED when enabled but the from-address is missing', async () => {
    const { service } = makeService({
      [RESEND_PLATFORM_SETTING_KEYS.enabled]: 'true',
      [RESEND_PLATFORM_SETTING_KEYS.apiKey]: 're_live_abc',
    });

    await expect(service.ensureAvailable()).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_MISCONFIGURED',
    });
  });

  it('never reuses PlatformSettingPort.isEnabled() (fail-closed on a missing row, not fail-open)', async () => {
    const isEnabled = jest.fn();
    const getValue = jest.fn().mockResolvedValue(null);
    const platformSettingPort = {
      isEnabled,
      getValue,
    } as unknown as PlatformSettingPort;
    const service = new EnsureEmailDeliveryAvailableService(
      platformSettingPort,
    );

    await expect(service.ensureAvailable()).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_DISABLED',
    });
    expect(isEnabled).not.toHaveBeenCalled();
  });
});
