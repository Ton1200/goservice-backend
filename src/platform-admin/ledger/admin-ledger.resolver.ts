import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AdminLedgerEntriesFilterInput } from './models/admin-ledger-entries-filter-input.model';
import { AdminLedgerEntriesPageModel } from './models/admin-ledger-entries-page.model';
import { ListAdminLedgerEntriesService } from './services/list-admin-ledger-entries.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`).
 * `adminLedgerEntries` requires `Permission.LEDGER_READ` — its own dedicated
 * permission (NOT `SERVICE_REQUESTS_READ`/any sibling `*_READ` — see the
 * `Permission` enum's own comment in `prisma/schema.prisma`).
 *
 * No module-enabled kill switch — the financial ledger has no
 * admin-configurable feature flag; auditing existing `LedgerEntry` history
 * is always available to a holder of `LEDGER_READ`.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminLedgerResolver {
  constructor(
    private readonly listAdminLedgerEntriesService: ListAdminLedgerEntriesService,
  ) {}

  @RequireAdminPermissions(Permission.LEDGER_READ)
  @Query(() => AdminLedgerEntriesPageModel, {
    description:
      'Lists every append-only LedgerEntry, paginated, optionally filtered by engagementId/professionalProfileId/from/to — a full financial audit trail (GOS-109).',
  })
  adminLedgerEntries(
    @Args('filter', { nullable: true }) filter?: AdminLedgerEntriesFilterInput,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number,
  ): Promise<AdminLedgerEntriesPageModel> {
    return this.listAdminLedgerEntriesService.listLedgerEntries(
      filter,
      limit,
      offset,
    );
  }
}
