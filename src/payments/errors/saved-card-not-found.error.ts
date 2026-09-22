import { DomainException } from '../../common/errors/domain-exception';

const SAVED_CARD_NOT_FOUND_CODE = 'SAVED_CARD_NOT_FOUND';

/**
 * Thrown when a saved card does not exist OR belongs to another Customer — the
 * two are deliberately indistinguishable (anti-enumeration, same reasoning as
 * `engagementNotFound()`).
 */
export function savedCardNotFound(): DomainException {
  return new DomainException(
    SAVED_CARD_NOT_FOUND_CODE,
    'Saved card not found.',
  );
}
