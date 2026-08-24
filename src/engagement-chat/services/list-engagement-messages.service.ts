import { Injectable } from '@nestjs/common';
import { EngagementChatAccessService } from '../engagement-chat-access.service';
import { EngagementChatRepository } from '../engagement-chat.repository';
import { EngagementMessageModel } from '../models/engagement-message.model';

/**
 * Orchestrates `Query.engagementMessages` — read access requires being a
 * party too (per the AC that a third party can't view the conversation), so
 * this goes through the exact same `EngagementChatAccessService.resolveParty`
 * the write operation uses, not a separate, looser read-only check. Same
 * pattern `ListQuoteNegotiationMessagesService` already establishes.
 */
@Injectable()
export class ListEngagementMessagesService {
  constructor(
    private readonly accessService: EngagementChatAccessService,
    private readonly engagementChatRepository: EngagementChatRepository,
  ) {}

  async listMessages(
    userId: string,
    engagementId: string,
  ): Promise<EngagementMessageModel[]> {
    await this.accessService.resolveParty(userId, engagementId);
    return this.engagementChatRepository.findMessagesByEngagementId(
      engagementId,
    );
  }
}
