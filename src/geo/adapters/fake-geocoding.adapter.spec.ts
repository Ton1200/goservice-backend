import { FakeGeocodingAdapter } from './fake-geocoding.adapter';

describe('FakeGeocodingAdapter', () => {
  it('is deterministic — the same address always resolves to the same coordinates', async () => {
    const adapter = new FakeGeocodingAdapter();

    const first = await adapter.geocode('Av. de Mayo 800, CABA');
    const second = await adapter.geocode('Av. de Mayo 800, CABA');

    expect(first).toEqual(second);
  });

  it('is case-insensitive — differently-cased same address resolves identically', async () => {
    const adapter = new FakeGeocodingAdapter();

    const lower = await adapter.geocode('av. de mayo 800, caba');
    const mixed = await adapter.geocode('Av. De Mayo 800, CABA');

    expect(lower).toEqual(mixed);
  });

  it('different addresses resolve to different coordinates', async () => {
    const adapter = new FakeGeocodingAdapter();

    const a = await adapter.geocode('Av. de Mayo 800, CABA');
    const b = await adapter.geocode('Av. Santa Fe 3253, CABA');

    expect(a).not.toEqual(b);
  });

  it('returns coordinates within CABA-plausible bounds', async () => {
    const adapter = new FakeGeocodingAdapter();

    const coordinates = await adapter.geocode('Av. Corrientes 1000, CABA');

    expect(coordinates!.latitude).toBeGreaterThan(-34.7);
    expect(coordinates!.latitude).toBeLessThan(-34.5);
    expect(coordinates!.longitude).toBeGreaterThan(-58.45);
    expect(coordinates!.longitude).toBeLessThan(-58.3);
  });

  it('resolves an empty/whitespace-only address to null (never throws)', async () => {
    const adapter = new FakeGeocodingAdapter();

    expect(await adapter.geocode('')).toBeNull();
    expect(await adapter.geocode('   ')).toBeNull();
  });

  it('never makes a real network call (no global.fetch usage)', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(() => {
      throw new Error('FakeGeocodingAdapter must never call fetch');
    });

    try {
      const adapter = new FakeGeocodingAdapter();
      await expect(
        adapter.geocode('Av. de Mayo 800, CABA'),
      ).resolves.not.toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
