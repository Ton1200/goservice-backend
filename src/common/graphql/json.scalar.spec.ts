import { Kind } from 'graphql';
import { JsonScalar } from './json.scalar';

describe('JsonScalar', () => {
  const scalar = new JsonScalar();

  describe('parseValue', () => {
    it('passes an object value through unchanged', () => {
      expect(scalar.parseValue({ enabled: true, clientId: 'abc' })).toEqual({
        enabled: true,
        clientId: 'abc',
      });
    });

    it('passes a primitive value through unchanged', () => {
      expect(scalar.parseValue('a-string')).toBe('a-string');
      expect(scalar.parseValue(42)).toBe(42);
      expect(scalar.parseValue(null)).toBeNull();
    });
  });

  describe('serialize', () => {
    it('passes an object value through unchanged', () => {
      expect(scalar.serialize({ enabled: true, clientId: 'abc' })).toEqual({
        enabled: true,
        clientId: 'abc',
      });
    });
  });

  describe('parseLiteral', () => {
    it('parses a GraphQL object literal into a plain object', () => {
      const result = scalar.parseLiteral({
        kind: Kind.OBJECT,
        fields: [
          {
            kind: Kind.OBJECT_FIELD,
            name: { kind: Kind.NAME, value: 'enabled' },
            value: { kind: Kind.BOOLEAN, value: true },
          },
        ],
      } as never);
      expect(result).toEqual({ enabled: true });
    });

    it('parses a GraphQL string literal into a plain string', () => {
      expect(
        scalar.parseLiteral({ kind: Kind.STRING, value: 'abc' } as never),
      ).toBe('abc');
    });
  });
});
