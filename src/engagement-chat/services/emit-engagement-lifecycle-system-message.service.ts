import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EngagementChatRepository } from '../engagement-chat.repository';

/**
 * GOS-125 — called from inside the SAME `prisma.$transaction` as each of the
 * 5 Engagement lifecycle-transition services (`StartEngagementWorkService`,
 * `MarkEngagementWorkFinishedService`, `ConfirmEngagementCompletionService`,
 * `CancelEngagementByCustomerService`, `CancelEngagementByProfessionalService`),
 * right after their guarded CAS status write succeeds. If this call throws,
 * the whole transition rolls back with it — an Engagement can never end up
 * in a new status without its narrating system message, or vice versa.
 *
 * Find-or-skip, NOT the idempotent upsert `SendEngagementMessageService`
 * uses: a system message is recorded ONLY IF an `EngagementChatConversation`
 * already exists for this Engagement. If no party ever sent a message, there
 * is no conversation, and this is a deliberate, silent no-op — creating one
 * just to hold a system message nobody will ever read would defeat the
 * upsert's own "created transparently on first real message" contract.
 *
 * Deliberately does NOT check `EngagementChatModuleEnabledGuard`'s
 * `customer.chat.enabled` `PlatformSetting` (and takes no
 * `PlatformSettingPort` dependency at all). That guard exists to gate
 * user-initiated chat actions at the resolver layer (`sendEngagementMessage`/
 * `engagementMessages`); its own header comment already documents an
 * analogous bypass for the platform-admin audit READ
 * (`adminEngagementChatThread`), reasoning that toggling off the
 * client-facing capability shouldn't erase or block visibility into
 * existing coordination history. This is the same category of exception but
 * for a WRITE, not a read: a system message is not a user "sending a
 * message" the toggle is meant to gate, it's an unconditional side effect of
 * a state transition that already happened — so it is recorded regardless of
 * the toggle, whenever a conversation already exists to receive it.
 */
@Injectable()
export class EmitEngagementLifecycleSystemMessageService {
  constructor(
    private readonly engagementChatRepository: EngagementChatRepository,
  ) {}

  async emit(
    tx: Prisma.TransactionClient,
    engagementId: string,
    content: string,
  ): Promise<void> {
    const conversation =
      await this.engagementChatRepository.findConversationByEngagementId(
        engagementId,
        tx,
      );
    if (!conversation) {
      // No conversation yet for this Engagement — find-or-skip, never
      // create one here.
      return;
    }
    await this.engagementChatRepository.createSystemMessage(
      tx,
      conversation.id,
      content,
    );
  }
}
