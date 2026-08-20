import { haversineDistanceKm } from './haversine.util';
import { LOCATION_GRID_METERS, snapToGrid } from './snap-to-grid.util';

describe('snapToGrid', () => {
  it('LOCATION_GRID_METERS is 500 (the business rule ADR 0006/DEC-005 fix)', () => {
    expect(LOCATION_GRID_METERS).toBe(500);
  });

  it('is idempotent — snapping an already-snapped point returns the same point (ADR 0006 rationale: this is what makes it safe against repeated-sampling attacks that would defeat random jitter)', () => {
    const raw = { latitude: -34.5875, longitude: -58.4306 };

    const snappedOnce = snapToGrid(raw);
    const snappedTwice = snapToGrid(snappedOnce);

    expect(snappedTwice.latitude).toBeCloseTo(snappedOnce.latitude, 9);
    expect(snappedTwice.longitude).toBeCloseTo(snappedOnce.longitude, 9);
  });

  it('is deterministic — the same input always produces the exact same output (never randomized)', () => {
    const raw = { latitude: -34.6037, longitude: -58.3816 };

    expect(snapToGrid(raw)).toEqual(snapToGrid(raw));
  });

  it('two nearby points inside the same grid cell collapse to the identical snapped coordinate', () => {
    const pointA = { latitude: 0.001, longitude: 0.001 };
    const pointB = { latitude: 0.0015, longitude: 0.0012 };

    const snappedA = snapToGrid(pointA);
    const snappedB = snapToGrid(pointB);

    expect(snappedA).toEqual({ latitude: 0, longitude: 0 });
    expect(snappedB).toEqual({ latitude: 0, longitude: 0 });
  });

  it('never moves a point further than roughly the grid cell size (bounded approximation error)', () => {
    const raw = { latitude: -34.5875, longitude: -58.4306 };

    const snapped = snapToGrid(raw);
    const errorKm = haversineDistanceKm(raw, snapped);

    expect(errorKm).toBeLessThan(1);
  });

  it('snaps latitude/longitude to exact multiples of the grid cell size (never an arbitrary offset)', () => {
    const snapped = snapToGrid({ latitude: -34.5875, longitude: -58.4306 });

    expect(snapToGrid(snapped)).toEqual(snapped);
  });
});
