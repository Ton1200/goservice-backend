/**
 * Thrown by application services for any hard business-rule failure that
 * must reach the GraphQL client as a typed error (`extensions.code`)
 * rather than as a partial/nullable payload field.
 *
 * See `src/common/filters/domain-exception.filter.ts` for how this is
 * translated into a `GraphQLError`, and the GOS-22 implementation plan
 * ("Decisiones y discrepancias", #2) for why `register`/`socialLogin`
 * hard failures are communicated this way instead of via the `errors`
 * field some payload types still declare for SDL fidelity.
 */
export class DomainException extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainException';
  }
}
