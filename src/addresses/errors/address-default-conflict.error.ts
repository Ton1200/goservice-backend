import { DomainException } from '../../common/errors/domain-exception';

const ADDRESS_DEFAULT_CONFLICT_CODE = 'ADDRESS_DEFAULT_CONFLICT';

/**
 * Thrown by `AddAddressService` (the first-Address-becomes-default race) and
 * `SetDefaultAddressService` when a write attempting to mark an `Address`
 * `isDefault: true` loses a race against a CONCURRENT write doing the same
 * for the same owning profile — surfaced by Postgres's `P2002` on the
 * partial unique index (`address_customer_default_unique` /
 * `address_professional_default_unique`, see that migration's own
 * comment), the last line of defense behind the application-level checks
 * both services already do. Same "generic conflict error, never a partial
 * write" idiom as `quotePriceProposalResolveConflict()`
 * (`src/quote-negotiation/errors/`).
 */
export function addressDefaultConflict(): DomainException {
  return new DomainException(
    ADDRESS_DEFAULT_CONFLICT_CODE,
    'This address could not be saved as default — it changed concurrently. Please try again.',
  );
}
