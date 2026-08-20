import { boundingBoxForRadius } from './bounding-box.util';
import { haversineDistanceKm } from './haversine.util';

describe('boundingBoxForRadius', () => {
  const buenosAires = { latitude: -34.6037, longitude: -58.3816 };

  it('produces a box centred on the given point', () => {
    const box = boundingBoxForRadius(buenosAires, 10);

    expect((box.minLat + box.maxLat) / 2).toBeCloseTo(buenosAires.latitude, 8);
    expect((box.minLng + box.maxLng) / 2).toBeCloseTo(buenosAires.longitude, 8);
  });

  it("the box's north edge sits ~radiusKm away by great-circle distance", () => {
    const radiusKm = 10;
    const box = boundingBoxForRadius(buenosAires, radiusKm);

    const northEdgePoint = {
      latitude: box.maxLat,
      longitude: buenosAires.longitude,
    };
    expect(haversineDistanceKm(buenosAires, northEdgePoint)).toBeCloseTo(
      radiusKm,
      1,
    );
  });

  it("the box's east edge sits ~radiusKm away by great-circle distance (cos-adjusted)", () => {
    const radiusKm = 10;
    const box = boundingBoxForRadius(buenosAires, radiusKm);

    const eastEdgePoint = {
      latitude: buenosAires.latitude,
      longitude: box.maxLng,
    };
    expect(haversineDistanceKm(buenosAires, eastEdgePoint)).toBeCloseTo(
      radiusKm,
      1,
    );
  });

  it('a point well inside the true search disk falls inside the box', () => {
    const radiusKm = 10;
    const box = boundingBoxForRadius(buenosAires, radiusKm);
    const nearbyPoint = {
      latitude: buenosAires.latitude + 0.005,
      longitude: buenosAires.longitude + 0.005,
    };

    expect(nearbyPoint.latitude).toBeGreaterThanOrEqual(box.minLat);
    expect(nearbyPoint.latitude).toBeLessThanOrEqual(box.maxLat);
    expect(nearbyPoint.longitude).toBeGreaterThanOrEqual(box.minLng);
    expect(nearbyPoint.longitude).toBeLessThanOrEqual(box.maxLng);
  });

  it('a point well outside the true search disk falls outside the box', () => {
    const radiusKm = 10;
    const box = boundingBoxForRadius(buenosAires, radiusKm);
    const farPoint = { latitude: -31.4201, longitude: -64.1888 };

    const insideLatRange =
      farPoint.latitude >= box.minLat && farPoint.latitude <= box.maxLat;
    const insideLngRange =
      farPoint.longitude >= box.minLng && farPoint.longitude <= box.maxLng;
    expect(insideLatRange && insideLngRange).toBe(false);
  });

  it('widens the longitude span (in degrees) at higher latitudes than at the equator, for the same radius', () => {
    const radiusKm = 50;
    const equatorBox = boundingBoxForRadius(
      { latitude: 0, longitude: -58 },
      radiusKm,
    );
    const highLatitudeBox = boundingBoxForRadius(
      { latitude: 80, longitude: -58 },
      radiusKm,
    );

    const equatorLngSpanDeg = equatorBox.maxLng - equatorBox.minLng;
    const highLatitudeLngSpanDeg =
      highLatitudeBox.maxLng - highLatitudeBox.minLng;

    expect(highLatitudeLngSpanDeg).toBeGreaterThan(equatorLngSpanDeg);
  });

  it('clamps latitude to [-90, 90] and stays finite near a pole (documented limitation, not a crash)', () => {
    const box = boundingBoxForRadius({ latitude: -89.9, longitude: 0 }, 50);

    expect(box.minLat).toBeGreaterThanOrEqual(-90);
    expect(box.maxLat).toBeLessThanOrEqual(90);
    expect(Number.isFinite(box.minLng)).toBe(true);
    expect(Number.isFinite(box.maxLng)).toBe(true);
  });
});
