import type { PaymentProviderRegistry } from './payment-provider.registry';

/**
 * Test helper (GOS-146): a `PaymentProviderRegistry` stand-in whose every
 * lookup — `forMethod` and each capability accessor — resolves to the ONE
 * fake provider a unit test builds, whatever method is asked for. The
 * registry's own mapping/failure behavior is tested in
 * `payment-provider.registry.spec.ts`; the services under test only need "the
 * adapter for this attempt/flow".
 */
export function makeRegistryFixture(provider: object): PaymentProviderRegistry {
  return {
    forMethod: () => provider,
    cardToken: () => provider,
    walletRedirect: () => provider,
    embeddedCheckout: () => provider,
    all: () => [provider],
  } as unknown as PaymentProviderRegistry;
}
