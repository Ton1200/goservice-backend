import { Injectable } from '@nestjs/common';
import { Engagement } from '@prisma/client';
import { engagementNotFound } from '../engagement-chat/errors/engagement-not-found.error';
import { EngagementsRepository } from '../engagements/engagements.repository';
import { ProfilesRepository } from '../profiles/profiles.repository';

/**
 * The ONE place that decides whether a caller may pay a given Engagement by
 * card. Unlike `CashPaymentAccessService` (where EITHER party may confirm
 * cash), only the Engagement's owning CUSTOMER can pay — a Professional, a
 * stranger and a nonexistent Engagement are all folded into the SAME
 * anti-enumeration `engagementNotFound()`, so the response never reveals
 * whether an Engagement id exists (same reasoning as
 * `CancelEngagementByCustomerService`/`ConfirmCashPaymentService`).
 *
 * `EngagementsRepository` is reused as a CONCRETE provider class (never by
 * importing the resolver-bearing `EngagementsModule`), same pattern as
 * `CashPaymentAccessService`.
 */
@Injectable()
export class CardPaymentAccessService {
  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly engagementsRepository: EngagementsRepository,
  ) {}

  async resolveCustomerEngagement(
    userId: string,
    engagementId: string,
  ): Promise<Engagement> {
    const engagement = await this.engagementsRepository.findById(engagementId);
    if (!engagement) {
      throw engagementNotFound();
    }

    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (
      !customerProfile ||
      engagement.customerProfileId !== customerProfile.id
    ) {
      throw engagementNotFound();
    }

    return engagement;
  }
}
