import { Injectable } from '@nestjs/common';
import {
  Category,
  CustomerProfile,
  ProfessionalProfile,
  ProfessionalVerificationStatus,
  SpecializationRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from '../users/users.repository';

interface SpecializationWithCategory {
  category: Category;
  role: SpecializationRole;
  description: string;
  yearsOfExperience: number | null;
  order: number;
}

type ProfessionalProfileWithSpecializations = ProfessionalProfile & {
  specializations: SpecializationWithCategory[];
};

/**
 * The ONLY place in this codebase that issues Prisma queries for
 * `CustomerProfile`/`ProfessionalProfile`/`Category`/
 * `ProfessionalSpecialization` — same data-ownership rule as
 * `UsersRepository`/`SessionsRepository`/`PasswordResetRepository` (see
 * goservice-docs/architecture/backend.md).
 *
 * The one deliberate exception: `upsertCustomerProfile` also transitions
 * `User.accountStatus`. Rather than querying `user` directly (which would
 * break that same ownership rule), it delegates that single write to
 * `UsersRepository.transitionToPendingApprovalIfEmailVerified`, passing its
 * own `$transaction`'s client through — see that method's doc comment for
 * the full rationale.
 */
@Injectable()
export class ProfilesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersRepository: UsersRepository,
  ) {}

  findCustomerProfileByUserId(userId: string): Promise<CustomerProfile | null> {
    return this.prisma.customerProfile.findUnique({ where: { userId } });
  }

  async findProfessionalProfileByUserId(
    userId: string,
  ): Promise<ProfessionalProfileWithSpecializations | null> {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId },
      include: {
        specializations: {
          include: { category: true },
          orderBy: { order: 'asc' },
        },
      },
    });
    if (!profile) {
      return null;
    }
    return this.flattenSpecializations(profile);
  }

  findAllCategories(): Promise<Category[]> {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }

  /**
   * Returns the subset of `categoryIds` that actually exist — the caller
   * (`UpsertProfessionalProfileService`) diffs this against the full
   * submitted list to reject any nonexistent ID with `CATEGORY_NOT_FOUND`.
   */
  async findExistingCategoryIds(categoryIds: string[]): Promise<string[]> {
    const rows = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Idempotent upsert keyed on `userId` (physically enforced by
   * `CustomerProfile.userId`'s `@unique`) — always exactly one row per
   * user, never a duplicate. On the row's first-ever creation (and only
   * then), atomically transitions `User.accountStatus` from
   * `EMAIL_VERIFIED` to `PENDING_APPROVAL` within the same transaction —
   * see the class doc comment above.
   */
  async upsertCustomerProfile(
    userId: string,
    data: {
      displayName: string;
      addressLine: string;
      city: string;
      province: string;
      country: string;
      photoUrl?: string;
    },
  ): Promise<{
    profile: CustomerProfile;
    wasCreated: boolean;
    accountStatusTransitioned: boolean;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.customerProfile.findUnique({
        where: { userId },
      });

      const profile = await tx.customerProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: { ...data },
      });

      const wasCreated = existing === null;
      const accountStatusTransitioned = wasCreated
        ? await this.usersRepository.transitionToPendingApprovalIfEmailVerified(
            userId,
            tx,
          )
        : false;

      return { profile, wasCreated, accountStatusTransitioned };
    });
  }

  /**
   * Idempotent upsert keyed on `userId` (physically enforced by
   * `ProfessionalProfile.userId`'s `@unique`). `verificationStatus` is
   * forced to `UNVERIFIED` on creation and never touched on update — no
   * caller can pass a different value in (see
   * `UpsertProfessionalProfileInput`, which has no such field). The
   * specialization set is a full replace on every call: every existing row
   * is deleted and every submitted one recreated (not just a
   * membership diff) — unlike a bare category-id join, each row here
   * carries its own `description`/`yearsOfExperience`/`order`, which can
   * change on an edit even when the same `categoryId` is resubmitted, so a
   * partial diff could leave stale field values in place. `order` is the
   * submitted array's index — never client-supplied.
   */
  async upsertProfessionalProfile(
    userId: string,
    data: {
      displayName: string;
      city: string;
      country: string;
      serviceAreaDescription: string;
      bio: string;
      photoUrl?: string;
      languages?: string[];
      specializations: {
        categoryId: string;
        role: SpecializationRole;
        description: string;
        yearsOfExperience?: number;
      }[];
    },
  ): Promise<{
    profile: ProfessionalProfileWithSpecializations;
    wasCreated: boolean;
  }> {
    const { specializations, ...profileData } = data;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.professionalProfile.findUnique({
        where: { userId },
      });

      const profile = await tx.professionalProfile.upsert({
        where: { userId },
        create: {
          userId,
          ...profileData,
          verificationStatus: ProfessionalVerificationStatus.UNVERIFIED,
        },
        update: profileData,
      });

      await tx.professionalSpecialization.deleteMany({
        where: { professionalProfileId: profile.id },
      });
      await tx.professionalSpecialization.createMany({
        data: specializations.map((specialization, index) => ({
          professionalProfileId: profile.id,
          categoryId: specialization.categoryId,
          role: specialization.role,
          description: specialization.description,
          yearsOfExperience: specialization.yearsOfExperience,
          order: index,
        })),
      });

      const rows = await tx.professionalSpecialization.findMany({
        where: { professionalProfileId: profile.id },
        include: { category: true },
        orderBy: { order: 'asc' },
      });

      return {
        profile: {
          ...profile,
          specializations: rows.map((row) => ({
            category: row.category,
            role: row.role,
            description: row.description,
            yearsOfExperience: row.yearsOfExperience,
            order: row.order,
          })),
        },
        wasCreated: existing === null,
      };
    });
  }

  private flattenSpecializations(
    profile: ProfessionalProfile & {
      specializations: {
        category: Category;
        role: SpecializationRole;
        description: string;
        yearsOfExperience: number | null;
        order: number;
      }[];
    },
  ): ProfessionalProfileWithSpecializations {
    const { specializations, ...rest } = profile;
    return {
      ...rest,
      specializations: specializations.map((row) => ({
        category: row.category,
        role: row.role,
        description: row.description,
        yearsOfExperience: row.yearsOfExperience,
        order: row.order,
      })),
    };
  }
}
