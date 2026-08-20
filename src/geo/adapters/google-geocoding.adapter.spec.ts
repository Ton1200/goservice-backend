import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { MAPS_PLATFORM_SETTING_KEYS } from '../constants/maps-settings.constants';
import { GoogleGeocodingAdapter } from './google-geocoding.adapter';

function buildPlatformSettingPort(values: Record<string, string | null> = {}) {
  const getValue = jest.fn((key: string) =>
    Promise.resolve(values[key] ?? null),
  );
  const platformSettingPort = {
    isEnabled: jest.fn((key: string) =>
      Promise.resolve(values[key] === 'true'),
    ),
    getValue,
  } as unknown as jest.Mocked<PlatformSettingPort>;
  return { platformSettingPort, getValue };
}

function enabledValues(overrides?: Record<string, string>) {
  return {
    [MAPS_PLATFORM_SETTING_KEYS.enabled]: 'true',
    [MAPS_PLATFORM_SETTING_KEYS.geocodingApiKey]: 'google-test-key',
    ...overrides,
  };
}

/** A minimal fetch-`Response`-shaped stub — only the members this adapter
 * ever reads (`ok`/`status`/`json()`), mirroring
 * `DiditIdentityVerificationAdapter.spec.ts`'s own `fakeResponse` helper. */
function fakeResponse(options: {
  ok: boolean;
  status: number;
  body?: unknown;
}): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: options.ok,
    status: options.status,
    json: () => Promise.resolve(options.body ?? {}),
  };
}

describe('GoogleGeocodingAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('resolves coordinates from a successful, OK-status Google response', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        body: {
          status: 'OK',
          results: [
            { geometry: { location: { lat: -34.6037, lng: -58.3816 } } },
          ],
        },
      }),
    );
    global.fetch = fetchMock;
    const { platformSettingPort } = buildPlatformSettingPort(enabledValues());
    const adapter = new GoogleGeocodingAdapter(platformSettingPort);

    const coordinates = await adapter.geocode('Av. de Mayo 800, CABA');

    expect(coordinates).toEqual({ latitude: -34.6037, longitude: -58.3816 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain('maps.googleapis.com/maps/api/geocode/json');
    expect(calledUrl).toContain('key=google-test-key');
  });

  it('returns null without calling fetch when disabled (never an availability dependency of onboarding)', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const { platformSettingPort } = buildPlatformSettingPort(
      enabledValues({ [MAPS_PLATFORM_SETTING_KEYS.enabled]: 'false' }),
    );
    const adapter = new GoogleGeocodingAdapter(platformSettingPort);

    const coordinates = await adapter.geocode('Av. de Mayo 800, CABA');

    expect(coordinates).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null without calling fetch when enabled but missing the api-key', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const values = enabledValues();
    values[MAPS_PLATFORM_SETTING_KEYS.geocodingApiKey] = '';
    const { platformSettingPort } = buildPlatformSettingPort(values);
    const adapter = new GoogleGeocodingAdapter(platformSettingPort);

    const coordinates = await adapter.geocode('Av. de Mayo 800, CABA');

    expect(coordinates).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null (never throws) on a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const { platformSettingPort } = buildPlatformSettingPort(enabledValues());
    const adapter = new GoogleGeocodingAdapter(platformSettingPort);

    await expect(adapter.geocode('Av. de Mayo 800, CABA')).resolves.toBeNull();
  });

  it('returns null (never throws) on a non-2xx response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse({ ok: false, status: 500 }));
    const { platformSettingPort } = buildPlatformSettingPort(enabledValues());
    const adapter = new GoogleGeocodingAdapter(platformSettingPort);

    await expect(adapter.geocode('Av. de Mayo 800, CABA')).resolves.toBeNull();
  });

  it('returns null (never throws) on an unparsable response body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('invalid JSON')),
    });
    const { platformSettingPort } = buildPlatformSettingPort(enabledValues());
    const adapter = new GoogleGeocodingAdapter(platformSettingPort);

    await expect(adapter.geocode('Av. de Mayo 800, CABA')).resolves.toBeNull();
  });

  it('returns null (never throws) on a ZERO_RESULTS status (address not found)', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        body: { status: 'ZERO_RESULTS', results: [] },
      }),
    );
    const { platformSettingPort } = buildPlatformSettingPort(enabledValues());
    const adapter = new GoogleGeocodingAdapter(platformSettingPort);

    await expect(
      adapter.geocode('this is not a real address at all'),
    ).resolves.toBeNull();
  });

  it('returns null on an OK status with a malformed/missing location shape', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        body: { status: 'OK', results: [{ geometry: {} }] },
      }),
    );
    const { platformSettingPort } = buildPlatformSettingPort(enabledValues());
    const adapter = new GoogleGeocodingAdapter(platformSettingPort);

    await expect(adapter.geocode('Av. de Mayo 800, CABA')).resolves.toBeNull();
  });

  it('reads enabled/api-key fresh on every geocode() call, not cached from construction', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      fakeResponse({
        ok: true,
        status: 200,
        body: {
          status: 'OK',
          results: [
            { geometry: { location: { lat: -34.6037, lng: -58.3816 } } },
          ],
        },
      }),
    );
    const { platformSettingPort, getValue } =
      buildPlatformSettingPort(enabledValues());
    const adapter = new GoogleGeocodingAdapter(platformSettingPort);

    await adapter.geocode('Address 1');
    await adapter.geocode('Address 2');

    expect(getValue).toHaveBeenCalledTimes(4);
  });
});
