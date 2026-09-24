import {
  GraphQLISODateTime,
  Parent,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import { EngagementModel } from '../engagements/models/engagement.model';
import { PlatformSettingPort } from '../platform-admin/platform-settings/ports/platform-setting.port';
import {
  readPostCompletionWindowHours,
  resolveEngagementChatClosure,
} from './services/resolve-engagement-chat-closure.util';

/**
 * GOS-123 — exposes the server-computed Engagement Chat closure on
 * `Engagement` itself (`engagementMessages` returns a bare list, so there is
 * no chat-level object to hang it on). Lives in `engagement-chat/`, not on
 * `EngagementModel`, so `EngagementsModule` never needs to know about
 * `PlatformSettingPort` or chat rules.
 *
 * Uses the exact same `resolveEngagementChatClosure` as
 * `SendEngagementMessageService`, so these fields always match what the
 * backend enforces — the mobile app must never compute the window itself.
 * Each field reads `customer.chat.post-completion-window-hours` fresh (a
 * single indexed lookup by key), only when the client selects the field.
 */
@Resolver(() => EngagementModel)
export class EngagementChatClosureFieldResolver {
  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  @ResolveField(() => Boolean, {
    name: 'chatReadOnly',
    description:
      'Whether the Engagement Chat is read-only now: always for a CANCELLED Engagement, and for a COMPLETED one once chatClosesAt has passed. sendEngagementMessage returns ENGAGEMENT_CHAT_CLOSED while this is true; reading the chat is always allowed.',
  })
  async chatReadOnly(@Parent() engagement: EngagementModel): Promise<boolean> {
    return (await this.resolveClosure(engagement)).chatReadOnly;
  }

  @ResolveField(() => GraphQLISODateTime, {
    name: 'chatClosesAt',
    nullable: true,
    description:
      'For a COMPLETED Engagement, the instant its chat becomes read-only (completedAt plus the admin-configured window). null for any other status.',
  })
  async chatClosesAt(
    @Parent() engagement: EngagementModel,
  ): Promise<Date | null> {
    return (await this.resolveClosure(engagement)).chatClosesAt;
  }

  private async resolveClosure(engagement: EngagementModel) {
    const windowHours = await readPostCompletionWindowHours(
      this.platformSettingPort,
    );
    return resolveEngagementChatClosure(
      {
        status: engagement.status,
        completedAt: engagement.completedAt ?? null,
      },
      windowHours,
      new Date(),
    );
  }
}
