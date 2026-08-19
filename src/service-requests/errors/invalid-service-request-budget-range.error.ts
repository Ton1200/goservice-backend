import { DomainException } from '../../common/errors/domain-exception';

const INVALID_SERVICE_REQUEST_BUDGET_RANGE_CODE =
  'INVALID_SERVICE_REQUEST_BUDGET_RANGE';

/**
 * Thrown by `PublishServiceRequestService` when both
 * `indicativeBudgetMin`/`indicativeBudgetMax` are submitted and
 * `indicativeBudgetMin > indicativeBudgetMax`. Not part of the GOS-38
 * plan's original error-code table — added here to cover the "min <= max"
 * validation that plan's "Budget" section calls for but didn't assign a
 * code to; follows the same naming/factory-function convention as every
 * other code in this module.
 */
export function invalidServiceRequestBudgetRange(): DomainException {
  return new DomainException(
    INVALID_SERVICE_REQUEST_BUDGET_RANGE_CODE,
    'indicativeBudgetMin cannot be greater than indicativeBudgetMax.',
  );
}
