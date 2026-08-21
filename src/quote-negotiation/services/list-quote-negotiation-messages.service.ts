import { Injectable } from '@nestjs/common';
import { QuoteNegotiationAccessService } from '../quote-negotiation-access.service';
import { QuoteNegotiationRepository } from '../quote-negotiation.repository';
import { QuoteNegotiationMessageModel } from '../models/quote-negotiation-message.model';

/**
 * Orchestrates `Query.quoteNegotiationMessages` — read access requires
 * being a party too (per the AC that a third party can't view the thread),
 * so this goes through the exact same `QuoteNegotiationAccessService.resolveParty`
 * every write operation uses, not a separate, looser read-only check.
 */
@Injectable()
export class ListQuoteNegotiationMessagesService {
  constructor(
    private readonly accessService: QuoteNegotiationAccessService,
    private readonly quoteNegotiationRepository: QuoteNegotiationRepository,
  ) {}

  async listMessages(
    userId: string,
    quoteId: string,
  ): Promise<QuoteNegotiationMessageModel[]> {
    await this.accessService.resolveParty(userId, quoteId);
    return this.quoteNegotiationRepository.findMessagesByQuoteId(quoteId);
  }
}
