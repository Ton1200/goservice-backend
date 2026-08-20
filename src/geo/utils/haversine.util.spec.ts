import { haversineDistanceKm } from './haversine.util';

describe('haversineDistanceKm', () => {
  it('returns 0 for two identical coordinates', () => {
    expect(
      haversineDistanceKm(
        { latitude: -34.6037, longitude: -58.3816 },
        { latitude: -34.6037, longitude: -58.3816 },
      ),
    ).toBe(0);
  });

  it('is symmetric — distance(a, b) === distance(b, a)', () => {
    const a = { latitude: -34.6037, longitude: -58.3816 };
    const b = { latitude: -34.5875, longitude: -58.4306 };

    expect(haversineDistanceKm(a, b)).toBeCloseTo(
      haversineDistanceKm(b, a),
      10,
    );
  });

  it('matches the textbook ~111.19 km for one degree of longitude at the equator', () => {
    const distance = haversineDistanceKm(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
    );

    expect(distance).toBeCloseTo((2 * Math.PI * 6371) / 360, 1);
  });

  it('matches the textbook ~111.19 km for one degree of latitude anywhere', () => {
    const distance = haversineDistanceKm(
      { latitude: -34, longitude: -58 },
      { latitude: -33, longitude: -58 },
    );

    expect(distance).toBeCloseTo((2 * Math.PI * 6371) / 360, 1);
  });

  it('reports a plausible ~2-3 km distance between real Palermo and Recoleta landmarks in Buenos Aires', () => {
    const plazaItalia = { latitude: -34.5811, longitude: -58.4198 };
    const centroCulturalRecoleta = { latitude: -34.5895, longitude: -58.3934 };

    const distance = haversineDistanceKm(plazaItalia, centroCulturalRecoleta);

    expect(distance).toBeGreaterThan(1);
    expect(distance).toBeLessThan(4);
  });

  it('a professional 600 km away is correctly reported as far, not near', () => {
    const buenosAires = { latitude: -34.6037, longitude: -58.3816 };
    const cordoba = { latitude: -31.4201, longitude: -64.1888 };

    expect(haversineDistanceKm(buenosAires, cordoba)).toBeGreaterThan(500);
  });
});
