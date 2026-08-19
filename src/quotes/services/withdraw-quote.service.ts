import { Injectable, Logger } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { professionalProfileRequired } from '../errors/professional-profile-required.error';
import { quoteNotFound } from '../errors/quote-not-found.error';
import { quoteNotSent } from '../errors/quote-not-sent.error';
import { QuoteModel } from '../models/quote.model';
import { QuotesRepository } from '../quotes.repository';

/**
 * Orchestrates `Mutation.withdrawQuote`. Ownership is ALWAYS resolved
 * server-side from `@CurrentUser()` — a Professional can never withdraw
 * another Professional's `Quote`. The pre-read exists for a good, specific
 * error message in the common case; the actual safety mechanism against a
 * concurrent `acceptQuote` is the guarded CAS in
 * `QuotesRepository.withdraw()` — a `count !== 1` there (this call lost the
 * race) is reported as the same `QUOTE_NOT_SENT` the pre-read would have
 * given had it read the post-race state.
 */
@Injectable()
export class WithdrawQuoteService {
  private readonly logger = new Logger(WithdrawQuoteService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly quotesRepository: QuotesRepository,
  ) {}

  async withdrawQuote(userId: string, quoteId: string): Promise<QuoteModel> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    if (!professionalProfile) {
      throw professionalProfileRequired();
    }

    const existing = await this.quotesRepository.findById(quoteId);
    if (
      !existing ||
      existing.professionalProfileId !== professionalProfile.id
    ) {
      // Same code for "doesn't exist" and "exists but isn't yours" —
      // deliberate anti-enumeration choice, see quoteNotFound()'s own
      // comment.
      throw quoteNotFound();
    }

    const { count } = await this.quotesRepository.withdraw(quoteId);
    if (count !== 1) {
      throw quoteNotSent();
    }

    const withdrawn = await this.quotesRepository.findById(quoteId);

    this.logger.log({
      event: 'quote_withdrawn',
      outcome: 'success',
      quoteId,
    });

    return withdrawn!;
  }
}
