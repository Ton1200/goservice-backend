import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { professionalProfileRequired } from '../errors/professional-profile-required.error';
import { QuoteModel } from '../models/quote.model';
import { QuotesRepository } from '../quotes.repository';

/**
 * Orchestrates `Query.myQuotes` — always "the caller's own Quotes",
 * derived from `@CurrentUser()`, no arguments.
 */
@Injectable()
export class ListMyQuotesService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly quotesRepository: QuotesRepository,
  ) {}

  async listMyQuotes(userId: string): Promise<QuoteModel[]> {
    const professionalProfile =
      await this.profilesRepository.findProfessionalProfileByUserId(userId);
    if (!professionalProfile) {
      throw professionalProfileRequired();
    }

    return this.quotesRepository.findManyByProfessionalProfileId(
      professionalProfile.id,
    );
  }
}
