import { CountryCode } from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { DiditIdentityVerificationAdapter } from '../adapters/didit-identity-verification.adapter';
import { IdentityVerificationProviderRegistry } from './identity-verification-provider-registry.service';

function buildPlatformSettingPort(
  enabledKeys: Set<string>,
): jest.Mocked<PlatformSettingPort> {
  return {
    isEnabled: jest.fn((key: string) => Promise.resolve(enabledKeys.has(key))),
    // `IdentityVerificationProviderRegistry.resolve` never calls
    // `getValue()` itself (only `isEnabled()`, for the 2 global kill
    // switches — credential reads belong to
    // `DiditIdentityVerificationAdapter` instead) — this is a typed,
    // always-`null` stub purely to satisfy `PlatformSettingPort`'s shape.
    getValue: jest
      .fn<Promise<string | null>, [string]>()
      .mockResolvedValue(null),
  };
}

describe('IdentityVerificationProviderRegistry', () => {
  const diditAdapter = {} as DiditIdentityVerificationAdapter;

  it('throws IDENTITY_VERIFICATION_DISABLED when the global identity.enabled switch is off', async () => {
    const registry = new IdentityVerificationProviderRegistry(
      diditAdapter,
      buildPlatformSettingPort(new Set()),
    );

    await expect(registry.resolve(CountryCode.AR)).rejects.toMatchObject<
      Partial<DomainException>
    >({ code: 'IDENTITY_VERIFICATION_DISABLED' });
  });

  it('throws IDENTITY_VERIFICATION_DISABLED when identity.enabled is on but identity.didit.enabled is off', async () => {
    const registry = new IdentityVerificationProviderRegistry(
      diditAdapter,
      buildPlatformSettingPort(new Set(['identity.enabled'])),
    );

    await expect(registry.resolve(CountryCode.AR)).rejects.toMatchObject<
      Partial<DomainException>
    >({ code: 'IDENTITY_VERIFICATION_DISABLED' });
  });

  it('resolves the Didit adapter for AR when both global switches are on, with no per-country config needed', async () => {
    const registry = new IdentityVerificationProviderRegistry(
      diditAdapter,
      buildPlatformSettingPort(
        new Set(['identity.enabled', 'identity.didit.enabled']),
      ),
    );

    await expect(registry.resolve(CountryCode.AR)).resolves.toBe(diditAdapter);
  });

  it('resolves the Didit adapter for CO too, with the exact same two global switches — no per-country routing switch exists anymore', async () => {
    const registry = new IdentityVerificationProviderRegistry(
      diditAdapter,
      buildPlatformSettingPort(
        new Set(['identity.enabled', 'identity.didit.enabled']),
      ),
    );

    await expect(registry.resolve(CountryCode.CO)).resolves.toBe(diditAdapter);
  });
});
