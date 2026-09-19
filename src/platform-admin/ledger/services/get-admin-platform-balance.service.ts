import { Injectable } from '@nestjs/common';
import { LedgerRepository } from '../../../ledger/ledger.repository';

/**
 * Orchestrates `Query.adminPlatformBalance` — GoService's own current
 * balance across every Professional and every payment method
 * (`LedgerRepository.sumProfessionalBalance`'s own header comment explains
 * the "computed fresh on every read" design). A thin pass-through; kept as
 * its own service (rather than the resolver calling `LedgerRepository`
 * directly) for the same "resolver -> service -> repository" layering every
 * other admin query in this codebase follows.
 */
@Injectable()
export class GetAdminPlatformBalanceService {
  constructor(private readonly ledgerRepository: LedgerRepository) {}

  getPlatformBalance(): Promise<number> {
    return this.ledgerRepository.sumPlatformBalance();
  }
}
