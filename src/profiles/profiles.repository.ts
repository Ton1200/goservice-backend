import { Injectable } from '@nestjs/common';
import {
  Category,
  CountryCode,
  CustomerProfile,
  Prisma,
  ProfessionalProfile,
  ProfessionalVerificationStatus,
  ProfilePhotoUploadRef,
  SpecializationRole,
  UserAccountStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersRepository } from '../users/users.repository';
import {
  buildCategoryTree,
  CategoryTreeNodeData,
  sortCategoriesInTreeOrder,
} from './utils/sort-categories-tree-order.util';

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
 * The one deliberate exception: both `upsertCustomerProfile` AND
 * `upsertProfessionalProfile` also transition `User.accountStatus`, on the
 * first successful creation of THEIR OWN profile type, whichever happens
 * first for a given user. Rather than querying `user` directly (which would
 * break that same ownership rule), each delegates that single write to
 * `UsersRepository.transitionToPendingApprovalIfEmailVerified`, passing its
 * own `$transaction`'s client through — see that method's doc comment for
 * the full rationale. Whichever profile type is created second for the same
 * user is always a safe no-op on this front (the `WHERE accountStatus =
 * EMAIL_VERIFIED` guard on that shared method already makes this race-safe
 * — see its own doc comment).
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

  /**
   * GOS-70 — sets (or clears, with `null`) ONLY the `photoUrl` column of an
   * existing profile, inside the caller's `$transaction` (the admin
   * profile-photo mutations pair this write with an `AdminAuditLog` write).
   * The caller pre-checks the profile exists for a friendly domain error;
   * Prisma still throws `P2025` here if the row vanished between the check
   * and the write.
   */
  setCustomerProfilePhoto(
    tx: Prisma.TransactionClient,
    userId: string,
    photoUrl: string | null,
  ): Promise<CustomerProfile> {
    return tx.customerProfile.update({ where: { userId }, data: { photoUrl } });
  }

  setProfessionalProfilePhoto(
    tx: Prisma.TransactionClient,
    userId: string,
    photoUrl: string | null,
  ): Promise<ProfessionalProfile> {
    return tx.professionalProfile.update({
      where: { userId },
      data: { photoUrl },
    });
  }

  /** GOS-70 — cheap existence check for the admin profile-photo mutations
   *  (avoids the specialization `include` that
   *  `findProfessionalProfileByUserId` carries). */
  async professionalProfileExists(userId: string): Promise<boolean> {
    const row = await this.prisma.professionalProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Identity Verification's ONE server-side source of truth for "which
   * country is this user in" — `StartIdentityVerificationService` calls
   * this instead of ever accepting a `country` argument from a GraphQL
   * input (see that service's own comment for why). Narrow
   * `select: { country: true }` reads on both tables, never the full
   * profile row.
   *
   * A user may hold both a `CustomerProfile` and a `ProfessionalProfile`
   * (no exclusivity rule — see this class's own header comment) with, in
   * theory, two different `country` values. `CustomerProfile` wins when
   * both exist — an arbitrary but deterministic, documented tie-break (not
   * a confirmed product rule; the plan left this open) since GoService's
   * KYC concern is about verifying the PERSON, not any one specific
   * profile's declared service area. Returns `null` only if the user has
   * created neither profile yet, which should never happen for an account
   * already in `PENDING_APPROVAL` (see `UsersRepository`'s own comment on
   * `transitionToPendingApprovalIfEmailVerified`) — callers still treat
   * `null` defensively rather than assuming it can't happen.
   */
  async findCountryForUser(userId: string): Promise<CountryCode | null> {
    const [customerProfile, professionalProfile] = await Promise.all([
      this.prisma.customerProfile.findUnique({
        where: { userId },
        select: { country: true },
      }),
      this.prisma.professionalProfile.findUnique({
        where: { userId },
        select: { country: true },
      }),
    ]);
    return customerProfile?.country ?? professionalProfile?.country ?? null;
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

  /**
   * Tree pre-order, not a bare alphabetical/DB-order list — see
   * `sortCategoriesInTreeOrder`'s own header comment. Every FLAT consumer of
   * the catalog (public `categories`, admin `serviceRequestCategories`/
   * `adminCategories`) goes through this one method, so all three always
   * agree on ordering.
   */
  async findAllCategories(): Promise<Category[]> {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return sortCategoriesInTreeOrder(categories);
  }

  /**
   * The admin panel's actual nested-tree shape (`adminCategoryTree` query,
   * `CategoryTreeNode`) — same underlying rows/sibling order as
   * `findAllCategories`, reshaped into real `children: []` nesting instead
   * of a flat pre-order list. See `buildCategoryTree`'s own header comment.
   */
  async findCategoryTree(): Promise<CategoryTreeNodeData[]> {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return buildCategoryTree(categories);
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
   * `categoryIds` themselves UNION every one of their descendants,
   * transitively — the hierarchical-matching primitive both
   * `ListCompatibleServiceRequestsService` (a Professional specialized in a
   * PARENT Category is compatible with every ServiceRequest nested under
   * it, not only the exact id they specialized in) and
   * `UpdateCategoryService` (cycle prevention: a Category can never become
   * its own descendant's descendant) build on. Computed in memory via a
   * plain BFS over a `{ id, parentId }` projection of the WHOLE table —
   * deliberately not a recursive SQL CTE (Prisma's query builder has no
   * native support for one, and this catalog is small by design, same
   * "no need for that machinery yet" reasoning as `sortCategoriesInTreeOrder`).
   */
  async findDescendantCategoryIds(categoryIds: string[]): Promise<string[]> {
    const rows = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const childIdsByParentId = new Map<string, string[]>();
    for (const row of rows) {
      if (row.parentId === null) {
        continue;
      }
      const siblings = childIdsByParentId.get(row.parentId) ?? [];
      siblings.push(row.id);
      childIdsByParentId.set(row.parentId, siblings);
    }

    const visited = new Set<string>();
    const queue = [...categoryIds];
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (currentId === undefined || visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);
      queue.push(...(childIdsByParentId.get(currentId) ?? []));
    }

    return [...visited];
  }

  // ---- platform-admin Category management (category-tree follow-up,
  // 2026-08-18) — the catalog is no longer purely seed-only; an admin can
  // create/rename/reorder/re-parent/delete entries from the panel. Writes
  // still live here exclusively per this class's own "ONLY place that
  // issues Prisma queries for ... Category" rule (see this class's own
  // header comment) — `CreateCategoryService`/`UpdateCategoryService`/
  // `DeleteCategoryService` (`src/platform-admin/categories/`) call these
  // directly, never Prisma themselves.

  findCategoryByIdForAdmin(id: string): Promise<Category | null> {
    return this.prisma.category.findUnique({ where: { id } });
  }

  /**
   * Case-insensitive exact-name lookup, powering the friendlier
   * `CATEGORY_NAME_TAKEN` pre-check both `CreateCategoryService` and
   * `UpdateCategoryService` do BEFORE writing — same instinct as
   * `UsersRepository.findByEmail`'s own pre-check role in
   * `UpdateUserAccountService`, rather than relying on the raw `@unique`
   * constraint's Prisma `P2002` error.
   */
  findCategoryByNameForAdmin(name: string): Promise<Category | null> {
    return this.prisma.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
  }

  countChildCategories(id: string): Promise<number> {
    return this.prisma.category.count({ where: { parentId: id } });
  }

  /**
   * The `ProfessionalSpecialization` half of `DeleteCategoryService`'s
   * "in use" pre-check — the `ServiceRequest` half
   * (`ServiceRequestsRepository.countByCategoryId`) lives in the OTHER
   * repository that actually owns that table, per this codebase's
   * per-table ownership rule (see this class's own header comment).
   */
  countSpecializationsByCategoryId(categoryId: string): Promise<number> {
    return this.prisma.professionalSpecialization.count({
      where: { categoryId },
    });
  }

  createCategoryForAdmin(
    tx: Prisma.TransactionClient,
    data: { name: string; displayOrder: number; parentId: string | null },
  ): Promise<Category> {
    return tx.category.create({ data });
  }

  /**
   * Runs inside the caller's own `$transaction`
   * (`UpdateCategoryService`/`DeleteCategoryService`) — same pattern as
   * `UsersRepository.updateForAdmin`: the `Category` write and the
   * `AdminAuditLog` write commit atomically or not at all.
   * `Prisma.CategoryUncheckedUpdateInput` (not the "checked" variant) is
   * used deliberately so `parentId` can be set directly as a plain
   * `string | null` rather than through `parent: { connect/disconnect }` —
   * the caller has already validated the target id's existence and
   * cycle-safety before calling this.
   */
  updateCategoryForAdmin(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.CategoryUncheckedUpdateInput,
  ): Promise<Category> {
    return tx.category.update({ where: { id }, data });
  }

  deleteCategoryForAdmin(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Category> {
    return tx.category.delete({ where: { id } });
  }

  // ---- platform-admin "create ServiceRequest for a customer" picker
  // (GOS-38 follow-up, 2026-08-18) — the one deliberate exception to this
  // class's own "never queries `user` directly" instinct: filtering by
  // `user.accountStatus`/searching `user.email` is a RELATION filter/select
  // on THIS class's own `customerProfile` table, not a second, competing
  // query against `User` itself — same reasoning `UsersRepository`'s own
  // `ADMIN_USER_ACCOUNT_SELECT` already established for the opposite
  // direction (reading `customerProfile`/`professionalProfile` presence off
  // of `User`).

  /**
   * `CustomerProfile`s whose owning `User` is `APPROVED` (this project's
   * "identity validated" state — see `UserAccountStatus`'s own schema
   * comment), optionally narrowed by a case-insensitive substring match on
   * `firstName`, `lastName`, or the owner's `email`. Powers
   * `eligibleServiceRequestCustomers` — an admin can only create a
   * `ServiceRequest` on behalf of a customer this method actually returns;
   * `CreateServiceRequestForCustomerService` re-checks both conditions
   * server-side regardless of what this picker showed (defense in depth,
   * not just a UI filter). Capped at 20 rows — a typeahead picker, not a
   * full listing.
   */
  findApprovedCustomerProfilesForAdmin(search?: string): Promise<
    (Pick<CustomerProfile, 'id' | 'firstName' | 'lastName'> & {
      user: {
        id: string;
        email: string;
      };
    })[]
  > {
    const trimmedSearch = search?.trim();
    const searchFilter: Prisma.CustomerProfileWhereInput = trimmedSearch
      ? {
          OR: [
            { firstName: { contains: trimmedSearch, mode: 'insensitive' } },
            { lastName: { contains: trimmedSearch, mode: 'insensitive' } },
            {
              user: {
                email: { contains: trimmedSearch, mode: 'insensitive' },
              },
            },
          ],
        }
      : {};

    return this.prisma.customerProfile.findMany({
      where: {
        user: { accountStatus: UserAccountStatus.APPROVED },
        ...searchFilter,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        user: {
          select: { id: true, email: true },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 20,
    });
  }

  /**
   * GOS-70 — creates the single-use `ProfilePhotoUploadRef` row backing one
   * `requestProfilePhotoUploadUrl` call. Same shape as
   * `ServiceRequestsRepository.createUploadRef`.
   */
  createProfilePhotoUploadRef(data: {
    userId: string;
    storageKey: string;
    fileUrl: string;
    expiresAt: Date;
  }): Promise<ProfilePhotoUploadRef> {
    return this.prisma.profilePhotoUploadRef.create({ data });
  }

  /**
   * GOS-70 — the ref is usable only if it is owned by `userId`, still
   * `PENDING`, and not past `expiresAt`. `null` otherwise; the caller
   * (`upsertCustomer/ProfessionalProfile` services) collapses every "not
   * usable" cause into a single `INVALID_PROFILE_PHOTO_UPLOAD_REF`
   * (anti-enumeration), exactly like `findUsablePendingUploadRefs`.
   */
  findUsablePendingPhotoUploadRef(
    userId: string,
    refId: string,
  ): Promise<ProfilePhotoUploadRef | null> {
    return this.prisma.profilePhotoUploadRef.findFirst({
      where: {
        id: refId,
        userId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });
  }

  /**
   * Idempotent upsert keyed on `userId` (physically enforced by
   * `CustomerProfile.userId`'s `@unique`) — always exactly one row per
   * user, never a duplicate. On the row's first-ever creation (and only
   * then), atomically transitions `User.accountStatus` from
   * `EMAIL_VERIFIED` to `PENDING_APPROVAL` within the same transaction —
   * see the class doc comment above.
   *
   * `photoUrl`/`locationSharingEnabled` (GOS-62) are genuinely optional,
   * partial-update fields: `undefined` when the caller's `data` object
   * omits them, and Prisma silently drops `undefined` keys from both
   * `create`/`update` payloads (its query engine serializes them out) —
   * so an edit that omits either one leaves the previously persisted value
   * untouched rather than resetting it. `create`'s missing value falls
   * back to the schema's own column default (`false` for
   * `locationSharingEnabled`, `null` for `photoUrl`).
   *
   * `photoUploadRefId` (GOS-70) is NOT a column — when present, the caller
   * has already resolved the ref to a usable row and set `photoUrl` to its
   * `fileUrl`; this method marks that ref `CONSUMED` inside the SAME
   * transaction as the profile write, so a ref can never be spent without
   * the profile actually being updated, and the `status: PENDING` guard on
   * the `updateMany` makes a concurrent double-spend a harmless no-op.
   */
  async upsertCustomerProfile(
    userId: string,
    data: {
      firstName: string;
      lastName: string;
      addressLine: string;
      city: string;
      province: string;
      country: CountryCode;
      photoUrl?: string;
      photoUploadRefId?: string;
      locationSharingEnabled?: boolean;
    },
  ): Promise<{
    profile: CustomerProfile;
    wasCreated: boolean;
    accountStatusTransitioned: boolean;
  }> {
    const { photoUploadRefId, ...profileData } = data;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.customerProfile.findUnique({
        where: { userId },
      });

      const profile = await tx.customerProfile.upsert({
        where: { userId },
        create: { userId, ...profileData },
        update: { ...profileData },
      });

      if (photoUploadRefId) {
        await tx.profilePhotoUploadRef.updateMany({
          where: { id: photoUploadRefId, userId, status: 'PENDING' },
          data: { status: 'CONSUMED', consumedAt: new Date() },
        });
      }

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
   *
   * On the row's first-ever creation (and only then), atomically
   * transitions `User.accountStatus` from `EMAIL_VERIFIED` to
   * `PENDING_APPROVAL` within the same transaction — the exact same
   * pattern `upsertCustomerProfile` above already uses, sharing the same
   * underlying `UsersRepository` method: see the class doc comment above.
   *
   * `locationSharingEnabled` (GOS-62) follows the exact same optional,
   * partial-update convention as `upsertCustomerProfile`'s own field of the
   * same name above — see that method's own comment.
   *
   * `displayName` (the optional "nombre comercial") extends that same
   * convention with explicit-null support: `undefined` is dropped by
   * Prisma (leaves the persisted value untouched on an edit, falls back to
   * the column's `NULL` default on create), whereas an explicit `null`
   * clears it.
   */
  async upsertProfessionalProfile(
    userId: string,
    data: {
      firstName: string;
      lastName: string;
      displayName?: string | null;
      city: string;
      country: CountryCode;
      serviceAreaDescription: string;
      bio: string;
      photoUrl?: string;
      photoUploadRefId?: string;
      languages?: string[];
      locationSharingEnabled?: boolean;
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
    accountStatusTransitioned: boolean;
  }> {
    // `specializations` is a child collection (full-replace); `photoUploadRefId`
    // is not a column (GOS-70 — see `upsertCustomerProfile`'s doc comment).
    const { specializations, photoUploadRefId, ...profileData } = data;

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

      if (photoUploadRefId) {
        await tx.profilePhotoUploadRef.updateMany({
          where: { id: photoUploadRefId, userId, status: 'PENDING' },
          data: { status: 'CONSUMED', consumedAt: new Date() },
        });
      }

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

      const wasCreated = existing === null;
      const accountStatusTransitioned = wasCreated
        ? await this.usersRepository.transitionToPendingApprovalIfEmailVerified(
            userId,
            tx,
          )
        : false;

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
        wasCreated,
        accountStatusTransitioned,
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
