import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { ListAdminCategoryTreeService } from './list-admin-category-tree.service';

describe('ListAdminCategoryTreeService', () => {
  it('delegates to ProfilesRepository.findCategoryTree', async () => {
    const tree = [
      {
        id: 'root',
        name: 'Electricidad',
        displayOrder: 0,
        parentId: null,
        children: [],
      },
    ];
    const findCategoryTree = jest.fn().mockResolvedValue(tree);
    const profilesRepository = {
      findCategoryTree,
    } as unknown as ProfilesRepository;

    const service = new ListAdminCategoryTreeService(profilesRepository);
    const result = await service.listCategoryTree();

    expect(findCategoryTree).toHaveBeenCalledWith();
    expect(result).toBe(tree);
  });
});
