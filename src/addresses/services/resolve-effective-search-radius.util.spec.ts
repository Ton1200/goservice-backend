import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY,
  MAPS_SEARCH_MAX_RADIUS_KM_KEY,
} from '../constants/maps-setting-keys.constants';
import { resolveEffectiveSearchRadiusKm } from './resolve-effective-search-radius.util';

describe('resolveEffectiveSearchRadiusKm', () => {
  function makePort(values: Record<string, string | null>) {
    const getValue = jest.fn((key: string) =>
      Promise.resolve(values[key] ?? null),
    );
    const port = {
      isEnabled: jest.fn(),
      getValue,
    } as unknown as PlatformSettingPort;
    return { port, getValue };
  }

  it('returns the configured default when requestedRadiusKm is omitted', async () => {
    const { port } = makePort({
      [MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY]: '15',
      [MAPS_SEARCH_MAX_RADIUS_KM_KEY]: '50',
    });

    await expect(resolveEffectiveSearchRadiusKm(port)).resolves.toBe(15);
  });

  it('returns the requested radius when it is below the configured max', async () => {
    const { port } = makePort({
      [MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY]: '15',
      [MAPS_SEARCH_MAX_RADIUS_KM_KEY]: '50',
    });

    await expect(resolveEffectiveSearchRadiusKm(port, 20)).resolves.toBe(20);
  });

  it('clamps the requested radius down to the configured max', async () => {
    const { port } = makePort({
      [MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY]: '15',
      [MAPS_SEARCH_MAX_RADIUS_KM_KEY]: '50',
    });

    await expect(resolveEffectiveSearchRadiusKm(port, 500)).resolves.toBe(50);
  });

  it('clamps the configured default down to the configured max', async () => {
    const { port } = makePort({
      [MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY]: '999',
      [MAPS_SEARCH_MAX_RADIUS_KM_KEY]: '50',
    });

    await expect(resolveEffectiveSearchRadiusKm(port)).resolves.toBe(50);
  });

  it('throws INVALID_SEARCH_RADIUS for a zero requested radius, before reading any setting', async () => {
    const { port, getValue } = makePort({});

    await expect(resolveEffectiveSearchRadiusKm(port, 0)).rejects.toMatchObject(
      { code: 'INVALID_SEARCH_RADIUS' },
    );
    expect(getValue).not.toHaveBeenCalled();
  });

  it('throws INVALID_SEARCH_RADIUS for a negative requested radius', async () => {
    const { port } = makePort({});

    await expect(
      resolveEffectiveSearchRadiusKm(port, -5),
    ).rejects.toMatchObject({ code: 'INVALID_SEARCH_RADIUS' });
  });

  it('throws MAPS_SEARCH_MISCONFIGURED when the default-radius setting is missing', async () => {
    const { port } = makePort({ [MAPS_SEARCH_MAX_RADIUS_KM_KEY]: '50' });

    await expect(resolveEffectiveSearchRadiusKm(port)).rejects.toMatchObject({
      code: 'MAPS_SEARCH_MISCONFIGURED',
    });
  });

  it('throws MAPS_SEARCH_MISCONFIGURED when the max-radius setting is missing', async () => {
    const { port } = makePort({ [MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY]: '15' });

    await expect(resolveEffectiveSearchRadiusKm(port)).rejects.toMatchObject({
      code: 'MAPS_SEARCH_MISCONFIGURED',
    });
  });

  it('throws MAPS_SEARCH_MISCONFIGURED when a setting value is non-numeric', async () => {
    const { port } = makePort({
      [MAPS_SEARCH_DEFAULT_RADIUS_KM_KEY]: 'not-a-number',
      [MAPS_SEARCH_MAX_RADIUS_KM_KEY]: '50',
    });

    await expect(resolveEffectiveSearchRadiusKm(port)).rejects.toMatchObject({
      code: 'MAPS_SEARCH_MISCONFIGURED',
    });
  });
});
