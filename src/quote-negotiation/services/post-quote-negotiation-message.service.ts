import { Injectable, Logger } from '@nestjs/common';
import { QuoteNegotiationParty, QuoteStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { QuoteNegotiationAccessService } from '../quote-negotiation-access.service';
import { QuoteNegotiationRepository } from '../quote-negotiation.repository';
import { quoteNotNegotiable } from '../errors/quote-not-negotiable.error';
import { quotePriceProposalDisabled } from '../errors/quote-price-proposal-disabled.error';
import { QuoteNegotiationMessageModel } from '../models/quote-negotiation-message.model';
import { PostQuoteNegotiationMessageInput } from '../models/post-quote-negotiation-message-input.model';

const CUSTOMER_CAN_PROPOSE_KEY =
  'quote-negotiation.price-edit.customer-can-propose';
const PROFESSIONAL_CAN_PROPOSE_KEY =
  'quote-negotiation.price-edit.professional-can-propose';

/**
 * Orchestrates `Mutation.postQuoteNegotiationMessage`. A `SENT` Quote is a
 * hard requirement (`quoteNotNegotiable()` otherwise) — negotiation only
 * ever happens on a Quote awaiting a decision, per the ticket's "ACCEPTED,
 * DECLINED o WITHDRAWN" blocks negotiation rule (mapped onto this
 * codebase's real `QuoteStatus`, see `quoteNotNegotiable()`'s own comment).
 *
 * If `input.proposedPrice` is supplied, the caller's role-specific
 * `quote-negotiation.price-edit.<role>-can-propose` flag is checked FIRST —
 * an explicit `quotePriceProposalDisabled()` is thrown when off. The price
 * is NEVER silently dropped: either the whole mutation succeeds with the
 * price attached, or it fails outright, per the AC.
 *
 * Inside one transaction: creates the `QuoteNegotiationMessage`, and — only
 * if a price was proposed — CAS-supersedes any existing `PENDING` proposal
 * for this Quote, then creates the new `QuotePriceProposal` (`PENDING`).
 * Owns the transaction boundary itself (injects `PrismaService` directly,
 * same pattern `AcceptQuoteService` establishes) since it spans two tables
 * `QuoteNegotiationRepository` owns.
 */
@Injectable()
export class PostQuoteNegotiationMessageService {
  private readonly logger = new Logger(PostQuoteNegotiationMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: QuoteNegotiationAccessService,
    private readonly platformSettingPort: PlatformSettingPort,
    private readonly quoteNegotiationRepository: QuoteNegotiationRepository,
  ) {}

  async postMessage(
    userId: string,
    quoteId: string,
    input: PostQuoteNegotiationMessageInput,
  ): Promise<QuoteNegotiationMessageModel> {
    const party = await this.accessService.resolveParty(userId, quoteId);

    if (party.quote.status !== QuoteStatus.SENT) {
      throw quoteNotNegotiable();
    }

    const hasProposedPrice = input.proposedPrice !== undefined;
    if (hasProposedPrice) {
      const flagKey =
        party.role === QuoteNegotiationParty.CUSTOMER
          ? CUSTOMER_CAN_PROPOSE_KEY
          : PROFESSIONAL_CAN_PROPOSE_KEY;
      const allowed = await this.platformSettingPort.isEnabled(flagKey);
      if (!allowed) {
        throw quotePriceProposalDisabled(party.role);
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const message = await this.quoteNegotiationRepository.createMessage(tx, {
        quoteId,
        authorRole: party.role,
        authorCustomerProfileId: party.customerProfileId,
        authorProfessionalProfileId: party.professionalProfileId,
        message: input.message,
      });

      if (!hasProposedPrice) {
        return { ...message, priceProposal: null };
      }

      await this.quoteNegotiationRepository.supersedePendingProposals(
        tx,
        quoteId,
      );
      const priceProposal =
        await this.quoteNegotiationRepository.createPriceProposal(tx, {
          quoteId,
          negotiationMessageId: message.id,
          proposedByRole: party.role,
          proposedByCustomerProfileId: party.customerProfileId,
          proposedByProfessionalProfileId: party.professionalProfileId,
          proposedPrice: input.proposedPrice!,
        });

      return { ...message, priceProposal };
    });

    this.logger.log({
      event: 'quote_negotiation_message_posted',
      outcome: 'success',
      quoteId,
      proposalId: created.priceProposal?.id,
    });

    return created;
  }
}
