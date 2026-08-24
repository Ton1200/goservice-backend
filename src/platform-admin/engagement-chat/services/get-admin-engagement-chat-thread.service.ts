import { Injectable } from '@nestjs/common';
import { EngagementsRepository } from '../../../engagements/engagements.repository';
import { EngagementChatRepository } from '../../../engagement-chat/engagement-chat.repository';
import { EngagementMessageModel } from '../../../engagement-chat/models/engagement-message.model';
import { adminEngagementNotFound } from '../errors/admin-engagement.errors';

/**
 * Orchestrates `Query.adminEngagementChatThread` — the admin panel's
 * read-only audit view of an Engagement's full coordination-chat history:
 * every message, in order. Reuses `EngagementMessageModel`
 * (`src/engagement-chat/models/`) DIRECTLY as this query's return type,
 * rather than a separate `AdminEngagementMessage`-named duplicate — same
 * "orphaned type made reachable" reasoning
 * `GetAdminQuoteNegotiationThreadService`'s own header comment already
 * documents for its sibling admin surface.
 */
@Injectable()
export class GetAdminEngagementChatThreadService {
  constructor(
    private readonly engagementsRepository: EngagementsRepository,
    private readonly engagementChatRepository: EngagementChatRepository,
  ) {}

  async getThread(engagementId: string): Promise<EngagementMessageModel[]> {
    const engagement = await this.engagementsRepository.findById(engagementId);
    if (!engagement) {
      throw adminEngagementNotFound(engagementId);
    }
    return this.engagementChatRepository.findMessagesByEngagementId(
      engagementId,
    );
  }
}
