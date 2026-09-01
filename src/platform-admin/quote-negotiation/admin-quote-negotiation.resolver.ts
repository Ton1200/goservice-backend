import { UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { QuoteNegotiationModuleEnabledGuard } from '../../quote-negotiation/guards/quote-negotiation-module-enabled.guard';
import { QuoteNegotiationMessageModel } from '../../quote-negotiation/models/quote-negotiation-message.model';
import { GetAdminQuoteNegotiationThreadService } from './services/get-admin-quote-negotiation-thread.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`),
 * PLUS `QuoteNegotiationModuleEnabledGuard` LAST (human decision, follow-up
 * to this feature's first round — REVERSES that round's original "not
 * gated by the flag" choice).
 *
 * **Gated by `Permission.QUOTE_NEGOTIATION_READ`** — a genuinely NEW,
 * dedicated permission (human decision, follow-up to this feature's first
 * round), REPLACING the first round's `Permission.SERVICE_REQUESTS_READ`
 * (the ticket-literal choice, itself flagged as a deliberate inconsistency
 * with `Permission.QUOTES_READ`, the sibling admin Quote-read surface's own
 * permission). See the `Permission` enum's own comment in
 * `prisma/schema.prisma` for the rationale.
 *
 * **Now ALSO gated by `quote-negotiation.general.enabled`**
 * (`QuoteNegotiationModuleEnabledGuard`, the SAME guard instance the
 * CONSUMER `QuoteNegotiationResolver` applies — reused, not duplicated) —
 * reverses the first round's "an admin's ability to audit EXISTING
 * negotiation history shouldn't disappear just because the client-facing
 * capability was toggled off" reasoning, per explicit human decision:
 * `adminQuoteNegotiationThread` now throws
 * `QUOTE_NEGOTIATION_MODULE_DISABLED` too when the flag is off, exactly
 * like every consumer operation in this module.
 */
@Resolver()
@UseGuards(
  AdminSessionGuard,
  AdminPermissionsGuard,
  QuoteNegotiationModuleEnabledGuard,
)
export class AdminQuoteNegotiationResolver {
  constructor(
    private readonly getAdminQuoteNegotiationThreadService: GetAdminQuoteNegotiationThreadService,
  ) {}

  @RequireAdminPermissions(Permission.QUOTE_NEGOTIATION_READ)
  @Query(() => [QuoteNegotiationMessageModel], {
    description:
      "Full negotiation thread (every message, every linked price proposal, UNREDACTED prices) for one Quote — an audit/support read-only view. Gated by QUOTE_NEGOTIATION_READ (its own dedicated permission) and by quote-negotiation.general.enabled (throws QUOTE_NEGOTIATION_MODULE_DISABLED when off) — see this resolver's own header comment.",
  })
  adminQuoteNegotiationThread(
    @Args('quoteId', { type: () => ID }) quoteId: string,
  ): Promise<QuoteNegotiationMessageModel[]> {
    return this.getAdminQuoteNegotiationThreadService.getThread(quoteId);
  }
}
