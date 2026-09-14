import { computeCommission } from './compute-commission.util';

describe('computeCommission', () => {
  it('splits a round amount evenly at 10%', () => {
    const { commission, net } = computeCommission(500, 10);

    expect(commission).toBe(50);
    expect(net).toBe(450);
    expect(commission + net).toBe(500);
  });

  it('rounds a non-dividing amount, and commission + net still equals amount exactly', () => {
    // 333 * 10 / 100 = 33.3 -> rounds to 33
    const { commission, net } = computeCommission(333, 10);

    expect(commission).toBe(33);
    expect(net).toBe(300);
    expect(commission + net).toBe(333);
  });

  it('commission + net === amount for a wide range of amounts/percentages, even under rounding', () => {
    for (let amount = 1; amount <= 1000; amount += 7) {
      for (const percent of [1, 7, 10, 13, 33, 50, 99]) {
        const { commission, net } = computeCommission(amount, percent);
        expect(commission + net).toBe(amount);
      }
    }
  });
});
