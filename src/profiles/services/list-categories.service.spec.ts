import { ProfilesRepository } from '../profiles.repository';
import { ListCategoriesService } from './list-categories.service';

describe('ListCategoriesService', () => {
  it('returns the repository category list unchanged', async () => {
    const categories = [
      { id: 'cat-1', name: 'Plomería' },
      { id: 'cat-2', name: 'Electricidad' },
    ];
    const findAllCategories = jest.fn().mockResolvedValue(categories);
    const profilesRepository = {
      findAllCategories,
    } as unknown as ProfilesRepository;
    const service = new ListCategoriesService(profilesRepository);

    const result = await service.listCategories();

    expect(result).toBe(categories);
    expect(findAllCategories).toHaveBeenCalledWith();
  });
});
