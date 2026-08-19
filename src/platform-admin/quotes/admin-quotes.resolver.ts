import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AdminQuoteDetailModel } from './models/admin-quote-detail.model';
import { AdminQuotesPageModel } from './models/admin-quotes-page.model';
import { GetAdminQuoteDetailService } from './services/get-admin-quote-detail.service';
import { ListAdminQuotesService } from './services/list-admin-quotes.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 * `quotes`/`quoteDetail` both require `Permission.QUOTES_READ` — READ-ONLY
 * grid, deliberately, unlike Service Requests: there is no sensible admin
 * analog to an admin fabricating a Quote on behalf of a Professional (a
 * Quote always needs a real ProfessionalProfile submitting against a real
 * OPEN ServiceRequest), so no `QUOTES_WRITE` permission or write mutation
 * exists here.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminQuotesResolver {
  constructor(
    private readonly listAdminQuotesService: ListAdminQuotesService,
    private readonly getAdminQuoteDetailService: GetAdminQuoteDetailService,
  ) {}

  @RequireAdminPermissions(Permission.QUOTES_READ)
  @Query(() => AdminQuotesPageModel, {
    description:
      'Lists Quotes across every ServiceRequest, paginated, including the ServiceRequest/Customer it was submitted against and the submitting Professional. Phase-1 scope: limit/offset only, no server-side filter/sort arguments yet — the admin panel does client-side filtering/sorting on the fetched page.',
  })
  quotes(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ): Promise<AdminQuotesPageModel> {
    return this.listAdminQuotesService.listQuotes(limit, offset);
  }

  @RequireAdminPermissions(Permission.QUOTES_READ)
  @Query(() => AdminQuoteDetailModel, {
    description:
      'Full detail view of one Quote, including the linked Engagement if this Quote was accepted (null otherwise). Same QUOTES_READ permission as quotes — no separate permission for this detail view.',
  })
  quoteDetail(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<AdminQuoteDetailModel> {
    return this.getAdminQuoteDetailService.getQuoteDetail(id);
  }
}
