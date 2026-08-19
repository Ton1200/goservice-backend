import { ProfilesRepository } from '../../profiles/profiles.repository';
import { ServiceRequestsRepository } from '../service-requests.repository';
import { ListCompatibleServiceRequestsService } from './list-compatible-service-requests.service';

describe('ListCompatibleServiceRequestsService', () => {
  const rows = [{ id: 'service-request-1', status: 'OPEN' }];

  function makeService(overrides?: {
    professionalProfile?: unknown;
    // Defaults to "no hierarchy" — the descendant set is just the input
    // set itself, so pre-existing (flat-catalog) test expectations keep
    // asserting the exact same categoryIds passed to findManyCompatible.
    descendantCategoryIds?: (ids: string[]) => string[];
  }) {
    const defaultProfile = {
      id: 'professional-profile-1',
      specializations: [
        { category: { id: 'cat-1', name: 'Plomería' } },
        { category: { id: 'cat-2', name: 'Electricidad' } },
      ],
    };
    const findProfessionalProfileByUserId = jest
      .fn()
      .mockResolvedValue(
        overrides?.professionalProfile === undefined
          ? defaultProfile
          : overrides.professionalProfile,
      );
    const findDescendantCategoryIds = jest
      .fn()
      .mockImplementation((ids: string[]) =>
        Promise.resolve(
          overrides?.descendantCategoryIds
            ? overrides.descendantCategoryIds(ids)
            : ids,
        ),
      );
    const profilesRepository = {
      findProfessionalProfileByUserId,
      findDescendantCategoryIds,
    } as unknown as ProfilesRepository;

    const findManyCompatible = jest.fn().mockResolvedValue(rows);
    const serviceRequestsRepository = {
      findManyCompatible,
    } as unknown as ServiceRequestsRepository;

    const service = new ListCompatibleServiceRequestsService(
      profilesRepository,
      serviceRequestsRepository,
    );

    return { service, findManyCompatible, findDescendantCategoryIds };
  }

  it('queries by every distinct category the professional specializes in', async () => {
    const { service, findManyCompatible } = makeService();

    const result = await service.listCompatibleServiceRequests('user-1');

    expect(findManyCompatible).toHaveBeenCalledWith(['cat-1', 'cat-2']);
    expect(result).toBe(rows);
  });

  it('dedupes repeated categories across specializations before expanding descendants', async () => {
    const { service, findDescendantCategoryIds } = makeService({
      professionalProfile: {
        id: 'professional-profile-1',
        specializations: [
          { category: { id: 'cat-1', name: 'Plomería' } },
          { category: { id: 'cat-1', name: 'Plomería' } },
        ],
      },
    });

    await service.listCompatibleServiceRequests('user-1');

    expect(findDescendantCategoryIds).toHaveBeenCalledWith(['cat-1']);
  });

  it('expands each specialized category to include its descendants (hierarchical matching)', async () => {
    const { service, findManyCompatible } = makeService({
      professionalProfile: {
        id: 'professional-profile-1',
        specializations: [{ category: { id: 'root-electricidad' } }],
      },
      descendantCategoryIds: () => ['root-electricidad', 'child-instalaciones'],
    });

    await service.listCompatibleServiceRequests('user-1');

    expect(findManyCompatible).toHaveBeenCalledWith([
      'root-electricidad',
      'child-instalaciones',
    ]);
  });

  it('returns an empty list when the caller has no ProfessionalProfile', async () => {
    const { service, findManyCompatible, findDescendantCategoryIds } =
      makeService({
        professionalProfile: null,
      });

    const result = await service.listCompatibleServiceRequests('user-1');

    expect(result).toEqual([]);
    expect(findDescendantCategoryIds).not.toHaveBeenCalled();
    expect(findManyCompatible).not.toHaveBeenCalled();
  });

  it('returns an empty list when the professional has zero specializations', async () => {
    const { service, findManyCompatible } = makeService({
      professionalProfile: {
        id: 'professional-profile-1',
        specializations: [],
      },
    });

    const result = await service.listCompatibleServiceRequests('user-1');

    expect(result).toEqual([]);
    expect(findManyCompatible).not.toHaveBeenCalled();
  });
});
