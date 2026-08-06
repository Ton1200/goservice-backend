import { Injectable } from '@nestjs/common';
import { Category } from '../models/category.model';
import { ProfilesRepository } from '../profiles.repository';

/**
 * Thin pass-through over the read-only, seed-only `Category` catalog. No
 * filtering/pagination in this story — the catalog is small by design.
 */
@Injectable()
export class ListCategoriesService {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  listCategories(): Promise<Category[]> {
    return this.profilesRepository.findAllCategories();
  }
}
