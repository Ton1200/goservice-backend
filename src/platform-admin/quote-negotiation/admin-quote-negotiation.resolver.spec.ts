import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { ADMIN_PERMISSIONS_METADATA_KEY } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { QuoteNegotiationModuleEnabledGuard } from '../../quote-negotiation/guards/quote-negotiation-module-enabled.guard';
import { AdminQuoteNegotiationResolver } from './admin-quote-negotiation.resolver';

/**
 * Wiring-only tests — the actual BEHAVIOR of each guard involved
 * (`AdminSessionGuard`/`AdminPermissionsGuard`/
 * `QuoteNegotiationModuleEnabledGuard`) is already fully unit-tested in its
 * own spec file (generic, resolver-agnostic — see
 * `admin-permissions.guard.spec.ts` and
 * `quote-negotiation-module-enabled.guard.spec.ts`). What's NOT covered
 * anywhere else is which guards/permissions THIS resolver actually
 * declares — verified here via the same `Reflector` metadata NestJS itself
 * reads at request time, rather than duplicating each guard's own
 * behavior test. No e2e test exists for this specific admin query yet
 * (pre-existing gap, unchanged by this round — see
 * `graphql-contract.md`'s "Quote Negotiation" admin section).
 */
describe('AdminQuoteNegotiationResolver wiring', () => {
  it('applies AdminSessionGuard, AdminPermissionsGuard, then QuoteNegotiationModuleEnabledGuard, in that exact order — auth guards first, the module-enabled kill switch last, so an underprivileged or unauthenticated admin never leaks whether the module is enabled/disabled', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminQuoteNegotiationResolver,
    ) as unknown[];

    expect(guards).toEqual([
      AdminSessionGuard,
      AdminPermissionsGuard,
      QuoteNegotiationModuleEnabledGuard,
    ]);
  });

  it("requires Permission.QUOTE_NEGOTIATION_READ on adminQuoteNegotiationThread — its own dedicated permission, NOT SERVICE_REQUESTS_READ (the first-round, ticket-literal choice) nor QUOTES_READ (the sibling admin Quote-read surface's own permission)", () => {
    const resolverPrototype = AdminQuoteNegotiationResolver.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading reflection metadata off the method reference, never invoking it with an unintended `this`.
    const handler = resolverPrototype.adminQuoteNegotiationThread;
    const required = Reflect.getMetadata(
      ADMIN_PERMISSIONS_METADATA_KEY,
      handler,
    ) as Permission[];

    expect(required).toEqual([Permission.QUOTE_NEGOTIATION_READ]);
  });

  it("includes QuoteNegotiationModuleEnabledGuard — so a caller who has QUOTE_NEGOTIATION_READ AND a valid admin session is still blocked (QUOTE_NEGOTIATION_MODULE_DISABLED, per that guard's own tested behavior) once quote-negotiation.general.enabled is off, exactly like every consumer operation in this module", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminQuoteNegotiationResolver,
    ) as unknown[];

    expect(guards).toContain(QuoteNegotiationModuleEnabledGuard);
  });
});
