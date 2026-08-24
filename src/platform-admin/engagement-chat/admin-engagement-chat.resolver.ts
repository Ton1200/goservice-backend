import { UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { RequireAdminPermissions } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { EngagementMessageModel } from '../../engagement-chat/models/engagement-message.model';
import { GetAdminEngagementChatThreadService } from './services/get-admin-engagement-chat-thread.service';

/**
 * Thin delivery adapter — same guard-ordering rule as every other
 * platform-admin resolver (`AdminSessionGuard` THEN `AdminPermissionsGuard`),
 * same shape as `AdminQuoteNegotiationResolver`.
 *
 * **Gated by `Permission.ENGAGEMENT_CHAT_READ`** — its own dedicated
 * permission (NOT `SERVICE_REQUESTS_READ`, per this ticket's own explicit
 * instruction, and NOT `QUOTE_NEGOTIATION_READ`, the sibling admin
 * negotiation-thread read surface's own permission) — reading a private
 * Engagement coordination conversation is a distinct, more sensitive
 * capability. See the `Permission` enum's own comment in
 * `prisma/schema.prisma` for the rationale.
 *
 * Unlike `AdminQuoteNegotiationResolver`, there is no module-enabled kill
 * switch here — Engagement Chat has no admin-configurable feature flag (no
 * ticket requirement for one), so no equivalent guard exists to apply.
 */
@Resolver()
@UseGuards(AdminSessionGuard, AdminPermissionsGuard)
export class AdminEngagementChatResolver {
  constructor(
    private readonly getAdminEngagementChatThreadService: GetAdminEngagementChatThreadService,
  ) {}

  @RequireAdminPermissions(Permission.ENGAGEMENT_CHAT_READ)
  @Query(() => [EngagementMessageModel], {
    description:
      'Full coordination-chat message history for one Engagement — an audit/support read-only view. Gated by ENGAGEMENT_CHAT_READ, its own dedicated permission.',
  })
  adminEngagementChatThread(
    @Args('engagementId', { type: () => ID }) engagementId: string,
  ): Promise<EngagementMessageModel[]> {
    return this.getAdminEngagementChatThreadService.getThread(engagementId);
  }
}
