import { Injectable } from '@nestjs/common';
import { Category } from '@prisma/client';
import { ProfilesRepository } from '../../../profiles/profiles.repository';

/**
 * Thin pass-through powering `Query.adminCategories` — the flat,
 * tree-pre-ordered list (see `ProfilesRepository.findAllCategories`'s own
 * comment). Gated by `CATEGORIES_READ`, distinct from
 * `serviceRequestCategories` (gated by `SERVICE_REQUESTS_WRITE`, a
 * narrower query for the create-ServiceRequest picker that happens to read
 * this same table for an unrelated purpose).
 */
@Injectable()
export class ListAdminCategoriesService {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  listCategories(): Promise<Category[]> {
    return this.profilesRepository.findAllCategories();
  }
}
