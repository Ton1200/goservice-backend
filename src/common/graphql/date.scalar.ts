import { Scalar, CustomScalar } from '@nestjs/graphql';
import { Kind, ValueNode } from 'graphql';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Calendar-date-only scalar (`YYYY-MM-DD`), distinct from the `DateTime`
 * scalar (`GraphQLISODateTime`, already used by `SystemStatus`) which
 * carries a time-of-day. Used for `RegisterInput.dateOfBirth` — a birth
 * date has no meaningful time component.
 *
 * No new dependency: built directly on `graphql`'s `GraphQLScalarType`
 * machinery via `@nestjs/graphql`'s `CustomScalar` interface.
 */
@Scalar('Date', () => Date)
export class DateScalar implements CustomScalar<string, Date> {
  description =
    'A calendar date string in YYYY-MM-DD format (no time-of-day component), e.g. 1990-05-21.';

  /** Value sent from the client (a `YYYY-MM-DD` string) -> internal `Date`. */
  parseValue(value: unknown): Date {
    if (typeof value !== 'string') {
      throw new TypeError('Date scalar expects a string in YYYY-MM-DD format.');
    }
    return this.parseDateOnlyString(value);
  }

  /** Internal `Date` -> value sent to the client (`YYYY-MM-DD` string). */
  serialize(value: unknown): string {
    const date = value instanceof Date ? value : new Date(value as string);
    if (Number.isNaN(date.getTime())) {
      throw new TypeError('Date scalar cannot serialize an invalid Date.');
    }
    return date.toISOString().slice(0, 10);
  }

  /** Value from a GraphQL query literal (e.g. `dateOfBirth: "1990-05-21"`). */
  parseLiteral(ast: ValueNode): Date {
    if (ast.kind !== Kind.STRING) {
      throw new TypeError(
        'Date scalar literal must be a string in YYYY-MM-DD format.',
      );
    }
    return this.parseDateOnlyString(ast.value);
  }

  private parseDateOnlyString(value: string): Date {
    if (!DATE_ONLY_PATTERN.test(value)) {
      throw new TypeError(
        `Date scalar expects YYYY-MM-DD format, received "${value}".`,
      );
    }

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    // Rejects calendar-invalid dates (e.g. 2026-02-30, which JS `Date`
    // otherwise silently rolls forward into March).
    const isRealCalendarDate =
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day;

    if (!isRealCalendarDate) {
      throw new TypeError(`"${value}" is not a valid calendar date.`);
    }

    return date;
  }
}
