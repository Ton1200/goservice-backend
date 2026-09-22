import {
  isSnapshotConsistentWithAttempt,
  roundToMajorUnits,
} from './payment-snapshot-consistency.util';

describe('roundToMajorUnits', () => {
  it.each([
    [50000, 50000],
    ['50000', 50000],
    ['50000.00', 50000],
    [50000.4, 50000],
    [50000.5, 50001],
    ['1234.567', 1235],
  ])(
    '%p -> %p (whole major units, like the Mercado Pago mapper)',
    (input, expected) => {
      expect(roundToMajorUnits(input)).toBe(expected);
    },
  );

  it.each([
    [null],
    [undefined],
    [''],
    ['  '],
    ['abc'],
    [NaN],
    [Infinity],
    [{}],
  ])('is null for something that is not a finite number (%p)', (input) => {
    expect(roundToMajorUnits(input)).toBeNull();
  });
});

describe('isSnapshotConsistentWithAttempt', () => {
  const attempt = { amount: 50000, currency: 'ARS' };

  it('accepts an approved snapshot for exactly the frozen amount and currency (case-insensitive currency)', () => {
    expect(
      isSnapshotConsistentWithAttempt(
        { status: 'approved', amount: 50000, currency: 'ars' },
        attempt,
      ),
    ).toBe(true);
  });

  it.each([
    ['a different amount', { amount: 49999, currency: 'ARS' }],
    ['a different currency', { amount: 50000, currency: 'COP' }],
    ['an unreported amount', { amount: null, currency: 'ARS' }],
    ['an unreported currency', { amount: 50000, currency: null }],
  ])('refuses to approve %s', (_label, reported) => {
    expect(
      isSnapshotConsistentWithAttempt(
        { status: 'approved', ...reported },
        attempt,
      ),
    ).toBe(false);
  });

  it.each([['pending'], ['rejected']] as const)(
    'does not check a %s snapshot — no money moves, so a mismatch is harmless',
    (status) => {
      expect(
        isSnapshotConsistentWithAttempt(
          { status, amount: 1, currency: 'COP' },
          attempt,
        ),
      ).toBe(true);
    },
  );
});
