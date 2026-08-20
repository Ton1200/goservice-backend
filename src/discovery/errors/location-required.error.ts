import { DomainException } from '../../common/errors/domain-exception';

const LOCATION_REQUIRED_CODE = 'LOCATION_REQUIRED';

/** Thrown when neither an explicit center nor a geocoded CustomerProfile address is available to search around. */
export function locationRequired(): DomainException {
  return new DomainException(
    LOCATION_REQUIRED_CODE,
    'A search centre is required: either pass one explicitly, or set a CustomerProfile address that can be geocoded.',
  );
}
