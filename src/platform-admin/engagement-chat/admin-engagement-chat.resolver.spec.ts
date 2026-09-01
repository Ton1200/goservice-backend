import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Permission } from '@prisma/client';
import { AdminSessionGuard } from '../admin-auth/guards/admin-session.guard';
import { AdminPermissionsGuard } from '../admin-rbac/guards/admin-permissions.guard';
import { ADMIN_PERMISSIONS_METADATA_KEY } from '../admin-rbac/decorators/require-admin-permissions.decorator';
import { AdminEngagementChatResolver } from './admin-engagement-chat.resolver';

/**
 * Wiring-only tests — same reasoning as
 * `admin-quote-negotiation.resolver.spec.ts`: the actual BEHAVIOR of
 * `AdminSessionGuard`/`AdminPermissionsGuard` is already fully unit-tested
 * in its own spec file. What's NOT covered anywhere else is which
 * guards/permissions THIS resolver actually declares.
 */
describe('AdminEngagementChatResolver wiring', () => {
  it('applies AdminSessionGuard then AdminPermissionsGuard, in that exact order', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminEngagementChatResolver,
    ) as unknown[];

    expect(guards).toEqual([AdminSessionGuard, AdminPermissionsGuard]);
  });

  it("requires Permission.ENGAGEMENT_CHAT_READ on adminEngagementChatThread — its own dedicated permission, NOT SERVICE_REQUESTS_READ nor QUOTE_NEGOTIATION_READ (the sibling admin thread-read surface's own permission)", () => {
    const resolverPrototype = AdminEngagementChatResolver.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- reading reflection metadata off the method reference, never invoking it with an unintended `this`.
    const handler = resolverPrototype.adminEngagementChatThread;
    const required = Reflect.getMetadata(
      ADMIN_PERMISSIONS_METADATA_KEY,
      handler,
    ) as Permission[];

    expect(required).toEqual([Permission.ENGAGEMENT_CHAT_READ]);
  });
});
