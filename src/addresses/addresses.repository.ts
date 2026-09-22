import { Injectable } from '@nestjs/common';
import { Address, AddressOwnerRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY place in this codebase that issues Prisma queries against
 * `Address` — same per-table data-ownership rule as `ProfilesRepository`/
 * `SavedCardRepository` (see `goservice-docs/architecture/backend.md`).
 *
 * EVERY method here takes the caller's own resolved owning profile id(s)
 * and filters by them — never just by `Address.id` alone — so a write can
 * never touch an Address belonging to a different profile, even if a
 * calling service forgot its own pre-check (defense in depth, same
 * instinct as `SavedCardRepository.findCardOfCustomer`). `id`-scoped writes
 * below still run as a guarded `updateMany`/`deleteMany` (never a bare
 * `update`/`delete` by `id`), matching that same "the WHERE clause itself
 * proves ownership" idiom.
 */
@Injectable()
export class AddressesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private ownerWhere(
    ownerRole: AddressOwnerRole,
    ownerProfileId: string,
  ): Prisma.AddressWhereInput {
    return ownerRole === AddressOwnerRole.CUSTOMER
      ? { ownerRole, customerProfileId: ownerProfileId }
      : { ownerRole, professionalProfileId: ownerProfileId };
  }

  findManyForOwner(
    ownerRole: AddressOwnerRole,
    ownerProfileId: string,
  ): Promise<Address[]> {
    return this.prisma.address.findMany({
      where: this.ownerWhere(ownerRole, ownerProfileId),
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  countForOwner(
    ownerRole: AddressOwnerRole,
    ownerProfileId: string,
  ): Promise<number> {
    return this.prisma.address.count({
      where: this.ownerWhere(ownerRole, ownerProfileId),
    });
  }

  /**
   * Looks up `addressId` scoped to the caller's OWN owned profile(s) —
   * `customerProfileId`/`professionalProfileId` are each optional, since a
   * caller may hold either, both, or (defensively) neither. Used by
   * `UpdateAddressService`/`DeleteAddressService`/`SetDefaultAddressService`,
   * none of which accept a client-supplied `ownerRole` (see those services'
   * own comments) — this is how they resolve "is this address mine, and
   * under which of my profiles" in one anti-enumeration-safe query. Returns
   * `null` (never a distinguishable "wrong owner" vs. "doesn't exist"
   * result) when neither branch matches, or when the caller holds neither
   * profile type at all.
   */
  findOneOwnedByEitherProfile(
    addressId: string,
    customerProfileId: string | null,
    professionalProfileId: string | null,
  ): Promise<Address | null> {
    const ownerClauses: Prisma.AddressWhereInput[] = [];
    if (customerProfileId) {
      ownerClauses.push({
        ownerRole: AddressOwnerRole.CUSTOMER,
        customerProfileId,
      });
    }
    if (professionalProfileId) {
      ownerClauses.push({
        ownerRole: AddressOwnerRole.PROFESSIONAL,
        professionalProfileId,
      });
    }
    if (ownerClauses.length === 0) {
      return Promise.resolve(null);
    }
    return this.prisma.address.findFirst({
      where: { id: addressId, OR: ownerClauses },
    });
  }

  create(data: {
    ownerRole: AddressOwnerRole;
    customerProfileId: string | null;
    professionalProfileId: string | null;
    formattedAddress: string;
    placeId: string;
    latitude: number;
    longitude: number;
    label: string | null;
    isDefault: boolean;
  }): Promise<Address> {
    return this.prisma.address.create({ data });
  }

  /**
   * Guarded partial update — `data`'s omitted (`undefined`) keys are
   * dropped by Prisma and leave the persisted value untouched, same
   * convention as `ProfilesRepository.upsertCustomerProfile`. Never touches
   * `isDefault`/`ownerRole`/the owner FKs. Returns `null` if the
   * `updateMany` matched zero rows (not found under this owner) instead of
   * throwing — the caller (`UpdateAddressService`) has already resolved the
   * row via `findOneOwnedByEitherProfile` before calling this, so a `null`
   * here only means a genuine concurrent delete raced it.
   */
  async updateForOwner(
    ownerRole: AddressOwnerRole,
    ownerProfileId: string,
    addressId: string,
    data: {
      formattedAddress?: string;
      placeId?: string;
      latitude?: number;
      longitude?: number;
      label?: string;
    },
  ): Promise<Address | null> {
    const result = await this.prisma.address.updateMany({
      where: { id: addressId, ...this.ownerWhere(ownerRole, ownerProfileId) },
      data,
    });
    if (result.count !== 1) {
      return null;
    }
    return this.prisma.address.findUnique({ where: { id: addressId } });
  }

  /** Guarded delete — see this class's own header comment. */
  async deleteForOwner(
    ownerRole: AddressOwnerRole,
    ownerProfileId: string,
    addressId: string,
  ): Promise<boolean> {
    const result = await this.prisma.address.deleteMany({
      where: { id: addressId, ...this.ownerWhere(ownerRole, ownerProfileId) },
    });
    return result.count === 1;
  }

  /**
   * Unsets the owning profile's current default (if any), THEN sets
   * `addressId` as the new default — both scoped to `ownerRole`/
   * `ownerProfileId`, inside one transaction, same self-contained
   * `$transaction` shape as `ProfilesRepository.upsertCustomerProfile`.
   * Returns `null` if `addressId` does not resolve under this owner (the
   * caller has already resolved it via `findOneOwnedByEitherProfile`, so
   * this only means a genuine concurrent delete raced it). A concurrent
   * SIBLING `setDefaultForOwner` call for the SAME owner (different
   * `addressId`) can still race this one past its own unset step — that
   * case is caught by the partial unique index
   * (`address_customer_default_unique` / `address_professional_default_unique`)
   * as a `Prisma.PrismaClientKnownRequestError` with `code === 'P2002'`,
   * which the caller (`SetDefaultAddressService`) translates into
   * `addressDefaultConflict()`.
   */
  setDefaultForOwner(
    ownerRole: AddressOwnerRole,
    ownerProfileId: string,
    addressId: string,
  ): Promise<Address | null> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.address.findFirst({
        where: { id: addressId, ...this.ownerWhere(ownerRole, ownerProfileId) },
      });
      if (!target) {
        return null;
      }
      if (target.isDefault) {
        return target;
      }
      await tx.address.updateMany({
        where: {
          ...this.ownerWhere(ownerRole, ownerProfileId),
          isDefault: true,
        },
        data: { isDefault: false },
      });
      return tx.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      });
    });
  }
}
