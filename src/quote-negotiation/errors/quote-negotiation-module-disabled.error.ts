import { DomainException } from '../../common/errors/domain-exception';

const QUOTE_NEGOTIATION_MODULE_DISABLED_CODE =
  'QUOTE_NEGOTIATION_MODULE_DISABLED';

/**
 * Thrown by `QuoteNegotiationModuleEnabledGuard` when the
 * `quote-negotiation.general.enabled` `PlatformSetting` currently resolves
 * to `false` — the GLOBAL kill switch for this whole capability
 * (comments AND price proposals alike). Applied to every resolver method in
 * `QuoteNegotiationResolver`, same "one guard, every operation" convention
 * as `AccountApprovedGuard`.
 */
export function quoteNegotiationModuleDisabled(): DomainException {
  return new DomainException(
    QUOTE_NEGOTIATION_MODULE_DISABLED_CODE,
    'Quote Negotiation is currently disabled.',
  );
}
