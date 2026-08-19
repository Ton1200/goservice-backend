import { registerEnumType } from '@nestjs/graphql';
import { EngagementStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `EngagementStatus` enum directly as a
 * GraphQL enum type. Deliberately a single value for now (`ACCEPTED`) — no
 * `IN_PROGRESS`/`COMPLETED`/etc. is added speculatively; see
 * `prisma/schema.prisma`'s own comment on this enum.
 */
registerEnumType(EngagementStatus, {
  name: 'EngagementStatus',
  description:
    'ACCEPTED is the only value today — set the moment a Quote is accepted. Reserved for future values (e.g. IN_PROGRESS/COMPLETED) once a real trigger for them exists.',
});

export { EngagementStatus };
