import { Injectable } from '@nestjs/common';
import { ServiceArea } from '../models/service-area.model';
import { ProfilesRepository } from '../profiles.repository';

/** Thin pass-through for `Query.myServiceArea` — returns `null` when no Service Area has been set (not an error). */
@Injectable()
export class GetMyServiceAreaService {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  getMyServiceArea(userId: string): Promise<ServiceArea | null> {
    return this.profilesRepository.findServiceAreaByUserId(userId);
  }
}
