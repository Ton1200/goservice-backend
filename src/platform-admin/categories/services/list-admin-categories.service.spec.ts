import { ProfilesRepository } from '../../../profiles/profiles.repository';
import { ListAdminCategoriesService } from './list-admin-categories.service';

describe('ListAdminCategoriesService', () => {
  it('delegates to ProfilesRepository.findAllCategories', async () => {
    const rows = [{ id: 'cat-1', name: 'Plomería' }];
    const findAllCategories = jest.fn().mockResolvedValue(rows);
    const profilesRepository = {
      findAllCategories,
    } as unknown as ProfilesRepository;

    const service = new ListAdminCategoriesService(profilesRepository);
    const result = await service.listCategories();

    expect(findAllCategories).toHaveBeenCalledWith();
    expect(result).toBe(rows);
  });
});
