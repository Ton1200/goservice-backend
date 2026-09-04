import { Injectable, Logger } from '@nestjs/common';
import { MediaUploadRefIntendedUse } from '@prisma/client';
import { invalidMediaUploadRef } from '../../media-uploads/errors/invalid-media-upload-ref.error';
import { MediaUploadsRepository } from '../../media-uploads/media-uploads.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { EngagementChatAccessService } from '../engagement-chat-access.service';
import { EngagementChatRepository } from '../engagement-chat.repository';
import { EngagementMessageModel } from '../models/engagement-message.model';
import { SendEngagementMessageInput } from '../models/send-engagement-message-input.model';

/**
 * Orchestrates `Mutation.sendEngagementMessage`. Idempotent Conversation
 * creation is the whole point of this service — there is no separate
 * "create conversation" mutation, and never will be: if no
 * `EngagementChatConversation` exists yet for this `engagementId`, it is
 * created transparently, in the SAME transaction as the message itself.
 *
 * Owns the transaction boundary itself (injects `PrismaService` directly,
 * same pattern `PostQuoteNegotiationMessageService` establishes) since it
 * spans two tables `EngagementChatRepository` owns, and the upsert+create
 * must commit atomically or not at all.
 *
 * Deliberately does NOT check `Engagement.status` — unlike Quote
 * Negotiation's `QUOTE_NOT_NEGOTIABLE` gate (Quote can move through several
 * non-negotiable terminal states), `EngagementStatus` today has exactly one
 * value (`ACCEPTED`, see that enum's own schema comment) — every Engagement
 * that exists is already in the one state this capability's business goal
 * requires ("Engagement ya aceptado"), so there is nothing to gate on yet.
 * If a future terminal `EngagementStatus` is ever added, whether it should
 * also close this chat is a new product question, not decided here.
 */
@Injectable()
export class SendEngagementMessageService {
  private readonly logger = new Logger(SendEngagementMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: EngagementChatAccessService,
    private readonly engagementChatRepository: EngagementChatRepository,
    private readonly mediaUploadsRepository: MediaUploadsRepository,
  ) {}

  async sendMessage(
    userId: string,
    engagementId: string,
    input: SendEngagementMessageInput,
  ): Promise<EngagementMessageModel> {
    const party = await this.accessService.resolveParty(userId, engagementId);

    // GOS-72 — resolve the optional coordination image ref BEFORE the
    // transaction (same read-then-consume ordering as GOS-38). `imageUrl` is
    // `null` unless a usable ref was supplied.
    let imageUrl: string | null = null;
    if (input.mediaUploadRefId) {
      const [ref] = await this.mediaUploadsRepository.findUsablePendingRefs(
        userId,
        [input.mediaUploadRefId],
        MediaUploadRefIntendedUse.ENGAGEMENT_CHAT_MESSAGE_IMAGE,
      );
      if (!ref) {
        throw invalidMediaUploadRef();
      }
      imageUrl = ref.fileUrl;
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const conversation =
        await this.engagementChatRepository.upsertConversation(
          tx,
          engagementId,
        );

      const created = await this.engagementChatRepository.createMessage(tx, {
        conversationId: conversation.id,
        senderRole: party.role,
        senderCustomerProfileId: party.customerProfileId,
        senderProfessionalProfileId: party.professionalProfileId,
        content: input.content,
        imageUrl,
      });

      if (input.mediaUploadRefId) {
        const { count } = await this.mediaUploadsRepository.markConsumed(tx, [
          input.mediaUploadRefId,
        ]);
        if (count !== 1) {
          // A concurrent consume spent the ref between the read above and
          // this write — roll the whole transaction back.
          throw invalidMediaUploadRef();
        }
      }

      return created;
    });

    this.logger.log({
      event: 'engagement_chat_message_sent',
      outcome: 'success',
      engagementId,
      conversationId: message.conversationId,
    });

    return message;
  }
}
