import { Injectable } from '@nestjs/common';
import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { CategoryTreeNode } from '../models/category-tree-node.model';

/**
 * Thin pass-through powering `Query.adminCategoryTree` — the admin panel's
 * nested-tree view. Same `CATEGORIES_READ` permission as `adminCategories`
 * (this is just a different SHAPE of the same underlying read, not a
 * different capability).
 */
@Injectable()
export class ListAdminCategoryTreeService {
  constructor(private readonly profilesRepository: ProfilesRepository) {}

  listCategoryTree(): Promise<CategoryTreeNode[]> {
    return this.profilesRepository.findCategoryTree();
  }
}
