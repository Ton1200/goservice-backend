import { Injectable } from '@nestjs/common';
import {
  EngagementChatConversation,
  EngagementChatMessage,
  EngagementChatParty,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `EngagementChatConversation`/`EngagementChatMessage` — same data-ownership
 * rule as `QuoteNegotiationRepository`/`EngagementsRepository` (see
 * goservice-docs/architecture/backend.md).
 */
@Injectable()
export class EngagementChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `SendEngagementMessageService`'s idempotent "create-if-missing"
   * primitive. Runs inside the caller's own `tx`. A single-unique-key
   * `upsert` compiles to Postgres's own `INSERT ... ON CONFLICT DO UPDATE`
   * — the race between two concurrent first-messages on the same Engagement
   * is resolved ATOMICALLY by the database itself, no catch/retry-refetch
   * needed. Same "idempotent upsert keyed on a single unique column"
   * pattern `ProfilesRepository.upsertCustomerProfile`/
   * `upsertProfessionalProfile` already establish for this codebase's other
   * "create on first use, never a separate create step" entities. `update:
   * {}` is a genuine no-op on the conflict path — there is nothing to
   * update on an existing Conversation, only its presence matters.
   */
  upsertConversation(
    tx: Prisma.TransactionClient,
    engagementId: string,
  ): Promise<EngagementChatConversation> {
    return tx.engagementChatConversation.upsert({
      where: { engagementId },
      create: { engagementId },
      update: {},
    });
  }

  findConversationByEngagementId(
    engagementId: string,
  ): Promise<EngagementChatConversation | null> {
    return this.prisma.engagementChatConversation.findUnique({
      where: { engagementId },
    });
  }

  /**
   * Part of `SendEngagementMessageService`'s transaction. Runs inside the
   * caller-owned `tx` — never opens its own transaction.
   */
  createMessage(
    tx: Prisma.TransactionClient,
    data: {
      conversationId: string;
      senderRole: EngagementChatParty;
      senderCustomerProfileId: string | null;
      senderProfessionalProfileId: string | null;
      content: string;
    },
  ): Promise<EngagementChatMessage> {
    return tx.engagementChatMessage.create({ data });
  }

  /**
   * Powers `Query.engagementMessages` — resolves the Engagement's
   * Conversation first (there may be none yet, if no message was ever
   * sent), then its messages, oldest first. Returns `[]`, not an error,
   * when no Conversation exists yet — a brand-new Engagement with no chat
   * history yet is a normal, expected state, not a failure.
   */
  async findMessagesByEngagementId(
    engagementId: string,
  ): Promise<EngagementChatMessage[]> {
    const conversation =
      await this.findConversationByEngagementId(engagementId);
    if (!conversation) {
      return [];
    }
    return this.prisma.engagementChatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });
  }
}
