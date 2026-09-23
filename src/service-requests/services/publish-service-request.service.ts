import { Injectable, Logger } from '@nestjs/common';
import { ServiceRequestAttachmentUploadRef } from '@prisma/client';
import { AddressesRepository } from '../../addresses/addresses.repository';
import { addressNotFound } from '../../addresses/errors/address-not-found.error';
import { DomainException } from '../../common/errors/domain-exception';
import { ProfilesRepository } from '../../profiles/profiles.repository';
import { customerProfileRequired } from '../errors/customer-profile-required.error';
import { invalidAttachmentUploadRef } from '../errors/invalid-attachment-upload-ref.error';
import { invalidServiceRequestBudgetRange } from '../errors/invalid-service-request-budget-range.error';
import { serviceRequestAddressRequired } from '../errors/service-request-address-required.error';
import { PublishServiceRequestInput } from '../models/publish-service-request-input.model';
import { ServiceRequestModel } from '../models/service-request.model';
import { ServiceRequestsRepository } from '../service-requests.repository';

/**
 * Orchestrates `Mutation.publishServiceRequest`. The owning `CustomerProfile`
 * is ALWAYS resolved server-side from `@CurrentUser()` — this service never
 * receives or trusts a `customerProfileId` from the caller (see
 * `PublishServiceRequestInput`, which has no such field).
 *
 * GOS-155 — `addressId` resolution: an explicit `input.addressId` must
 * resolve to an Address owned by the caller's own `CustomerProfile`
 * (`ownerRole: CUSTOMER`) or the whole mutation rejects with
 * `ADDRESS_NOT_FOUND` (same anti-enumeration error/idiom
 * `UpdateAddressService`/`DeleteAddressService` already use — never reveals
 * whether the id exists under a DIFFERENT owner). When omitted, this falls
 * back to the caller's own `isDefault` Address; if the caller has none at
 * all, the mutation rejects with `SERVICE_REQUEST_ADDRESS_REQUIRED` —
 * every NEWLY published `ServiceRequest` always gets a non-null
 * `addressId` (no "publish now, add an Address later" path — see that
 * error's own header comment).
 */
@Injectable()
export class PublishServiceRequestService {
  private readonly logger = new Logger(PublishServiceRequestService.name);

  constructor(
    private readonly profilesRepository: ProfilesRepository,
    private readonly serviceRequestsRepository: ServiceRequestsRepository,
    private readonly addressesRepository: AddressesRepository,
  ) {}

  async publishServiceRequest(
    userId: string,
    input: PublishServiceRequestInput,
  ): Promise<ServiceRequestModel> {
    const customerProfile =
      await this.profilesRepository.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      // Should never happen once AccountApprovedGuard already confirmed
      // APPROVED — see customerProfileRequired()'s own comment.
      throw customerProfileRequired();
    }

    const existingCategoryIds =
      await this.profilesRepository.findExistingCategoryIds([input.category]);
    if (existingCategoryIds.length === 0) {
      // Same code `profiles/upsert-professional-profile.service.ts` already
      // uses for a nonexistent category — reused deliberately, not
      // duplicated under a new name.
      throw new DomainException(
        'CATEGORY_NOT_FOUND',
        `The following category IDs do not exist: ${input.category}.`,
      );
    }

    if (
      input.indicativeBudgetMin !== undefined &&
      input.indicativeBudgetMax !== undefined &&
      input.indicativeBudgetMin > input.indicativeBudgetMax
    ) {
      throw invalidServiceRequestBudgetRange();
    }

    const attachmentRefs = await this.resolveAttachmentRefs(
      userId,
      input.attachmentUploadRefs ?? [],
    );

    const addressId = await this.resolveAddressId(
      customerProfile.id,
      input.addressId,
    );

    const serviceRequest = await this.serviceRequestsRepository.publish({
      customerProfileId: customerProfile.id,
      categoryId: input.category,
      description: input.description,
      urgency: input.urgency,
      indicativeBudgetMin: input.indicativeBudgetMin ?? null,
      indicativeBudgetMax: input.indicativeBudgetMax ?? null,
      addressId,
      attachmentRefs,
    });

    this.logger.log({
      event: 'service_request_published',
      outcome: 'success',
      serviceRequestId: serviceRequest.id,
      categoryId: serviceRequest.categoryId,
      attachmentCount: serviceRequest.attachments.length,
    });

    return serviceRequest;
  }

  /**
   * GOS-155 — see this class's own header comment for the full rule. An
   * explicit `addressId` is checked ONLY against `customerProfileId`
   * (never `professionalProfileId` — a `ServiceRequest`'s Address always
   * belongs to the CUSTOMER side, unlike `AddressesRepository.
   * findOneOwnedByEitherProfile`'s dual-owner check used elsewhere).
   */
  private async resolveAddressId(
    customerProfileId: string,
    explicitAddressId: string | undefined,
  ): Promise<string> {
    if (explicitAddressId) {
      const address =
        await this.addressesRepository.findOneOwnedByEitherProfile(
          explicitAddressId,
          customerProfileId,
          null,
        );
      if (!address) {
        throw addressNotFound();
      }
      return address.id;
    }

    const defaultAddress =
      await this.addressesRepository.findDefaultForCustomerProfile(
        customerProfileId,
      );
    if (!defaultAddress) {
      throw serviceRequestAddressRequired();
    }
    return defaultAddress.id;
  }

  /**
   * Validates every submitted ref (ownership, PENDING status, not expired
   * — see `ServiceRequestsRepository.findUsablePendingUploadRefs`) and
   * returns the resolved rows in the SAME order the client submitted them,
   * so `ServiceRequestsRepository.publish` can derive stable
   * `ServiceRequestAttachment.order` values from that order. Any ref that
   * doesn't come back as "usable" — for any reason (doesn't exist, belongs
   * to someone else, already consumed, expired) — rejects the WHOLE
   * mutation with one generic, anti-enumeration error; no `ServiceRequest`
   * is created with a partial attachment set.
   */
  private async resolveAttachmentRefs(
    userId: string,
    refIds: string[],
  ): Promise<ServiceRequestAttachmentUploadRef[]> {
    if (refIds.length === 0) {
      return [];
    }

    const usableRefs =
      await this.serviceRequestsRepository.findUsablePendingUploadRefs(
        userId,
        refIds,
      );
    if (usableRefs.length !== refIds.length) {
      throw invalidAttachmentUploadRef();
    }

    const usableRefsById = new Map(
      usableRefs.map((ref) => [ref.id, ref] as const),
    );
    return refIds.map((refId) => usableRefsById.get(refId)!);
  }
}
