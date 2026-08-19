import { registerEnumType } from '@nestjs/graphql';
import { ServiceRequestStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `ServiceRequestStatus` enum directly as a
 * GraphQL enum type — same reasoning as `ProfessionalVerificationStatus`/
 * `SpecializationRole`: the GraphQL and persistence shapes are meant to be
 * identical. Deliberately minimal (`OPEN`/`CANCELLED` only) — see
 * `prisma/schema.prisma`'s own comment on this enum for why no
 * Quote/Engagement-related state is added yet.
 */
registerEnumType(ServiceRequestStatus, {
  name: 'ServiceRequestStatus',
  description:
    'OPEN while visible to compatible Professionals; CANCELLED once the owning Customer cancels it. CANCELLED is terminal in this story — it never reverts to OPEN.',
});

export { ServiceRequestStatus };
