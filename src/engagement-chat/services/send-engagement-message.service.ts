import { Injectable, Logger } from '@nestjs/common';
import { MediaUploadRefIntendedUse } from '@prisma/client';
import { invalidMediaUploadRef } from '../../media-uploads/errors/invalid-media-upload-ref.error';
import { MediaUploadsRepository } from '../../media-uploads/media-uploads.repository';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { PrismaService } from '../../prisma/prisma.service';
import { EngagementChatAccessService } from '../engagement-chat-access.service';
import { EngagementChatRepository } from '../engagement-chat.repository';
import { engagementChatClosed } from '../errors/engagement-chat-closed.error';
import { EngagementMessageModel } from '../models/engagement-message.model';
import { SendEngagementMessageInput } from '../models/send-engagement-message-input.model';
import {
  readPostCompletionWindowHours,
  resolveEngagementChatClosure,
} from './resolve-engagement-chat-closure.util';

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
 * GOS-123 — the chat becomes read-only once the Engagement is closed: a
 * `CANCELLED` Engagement rejects new messages immediately, a `COMPLETED`
 * one only after `completedAt + customer.chat.post-completion-window-hours`
 * (read fresh here on every send, never cached). Any other status is
 * writable. The decision itself lives in `resolveEngagementChatClosure`,
 * shared with `Engagement.chatReadOnly`/`chatClosesAt`, and is checked
 * BEFORE the optional image ref is resolved, so a rejected send never
 * touches it. Only this user-facing send path is gated: reading
 * (`ListEngagementMessagesService`), lifecycle system messages
 * (`EmitEngagementLifecycleSystemMessageService` — e.g. the cancellation
 * one is written the very moment the chat closes) and the admin thread are
 * unaffected.
 */
@Injectable()
export class SendEngagementMessageService {
  private readonly logger = new Logger(SendEngagementMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: EngagementChatAccessService,
    private readonly engagementChatRepository: EngagementChatRepository,
    private readonly mediaUploadsRepository: MediaUploadsRepository,
    private readonly platformSettingPort: PlatformSettingPort,
  ) {}

  async sendMessage(
    userId: string,
    engagementId: string,
    input: SendEngagementMessageInput,
  ): Promise<EngagementMessageModel> {
    const party = await this.accessService.resolveParty(userId, engagementId);

    const windowHours = await readPostCompletionWindowHours(
      this.platformSettingPort,
    );
    const { chatReadOnly } = resolveEngagementChatClosure(
      party.engagement,
      windowHours,
      new Date(),
    );
    if (chatReadOnly) {
      throw engagementChatClosed();
    }

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
