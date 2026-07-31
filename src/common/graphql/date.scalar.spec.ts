import { Kind } from 'graphql';
import { DateScalar } from './date.scalar';

describe('DateScalar', () => {
  const scalar = new DateScalar();

  describe('parseValue', () => {
    it('parses a valid YYYY-MM-DD string into a Date', () => {
      const date = scalar.parseValue('1990-05-21');
      expect(date.getUTCFullYear()).toBe(1990);
      expect(date.getUTCMonth()).toBe(4); // 0-indexed
      expect(date.getUTCDate()).toBe(21);
    });

    it('rejects a non-string value', () => {
      expect(() => scalar.parseValue(12345)).toThrow(TypeError);
    });

    it('rejects a calendar-invalid date (2026-02-30)', () => {
      expect(() => scalar.parseValue('2026-02-30')).toThrow(TypeError);
    });

    it('rejects a malformed string', () => {
      expect(() => scalar.parseValue('05/21/1990')).toThrow(TypeError);
    });
  });

  describe('serialize', () => {
    it('serializes a Date back to YYYY-MM-DD', () => {
      const date = new Date(Date.UTC(1990, 4, 21));
      expect(scalar.serialize(date)).toBe('1990-05-21');
    });

    it('throws when serializing an invalid Date', () => {
      expect(() => scalar.serialize(new Date('not-a-date'))).toThrow(TypeError);
    });
  });

  describe('parseLiteral', () => {
    it('parses a GraphQL string literal', () => {
      const date = scalar.parseLiteral({
        kind: Kind.STRING,
        value: '1990-05-21',
      } as never);
      expect(date.getUTCFullYear()).toBe(1990);
    });

    it('rejects a non-string literal', () => {
      expect(() =>
        scalar.parseLiteral({ kind: Kind.INT, value: '123' } as never),
      ).toThrow(TypeError);
    });
  });
});
