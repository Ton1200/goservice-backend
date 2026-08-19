import { registerEnumType } from '@nestjs/graphql';
import { ServiceRequestStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `ServiceRequestStatus` enum directly as a
 * GraphQL enum type — same reasoning as `ProfessionalVerificationStatus`/
 * `SpecializationRole`: the GraphQL and persistence shapes are meant to be
 * identical. `ENGAGED` (GOS-41) is now real — see `prisma/schema.prisma`'s
 * own comment on this enum.
 */
registerEnumType(ServiceRequestStatus, {
  name: 'ServiceRequestStatus',
  description:
    'OPEN while visible to compatible Professionals and open to new Quotes; CANCELLED once the owning Customer cancels it (only possible while OPEN); ENGAGED once one of its Quotes has been accepted. CANCELLED and ENGAGED are both terminal — neither reverts to OPEN.',
});

export { ServiceRequestStatus };
