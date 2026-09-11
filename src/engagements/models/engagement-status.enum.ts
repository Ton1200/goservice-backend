import { registerEnumType } from '@nestjs/graphql';
import { EngagementStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `EngagementStatus` enum directly as a
 * GraphQL enum type. GOS-111 grew this from a single value to the
 * work-execution state machine — see `prisma/schema.prisma`'s own comment.
 * `ACCEPTED → IN_PROGRESS → PENDING_CUSTOMER_CONFIRMATION` are the
 * Professional-driven transitions implemented by GOS-111
 * (`startEngagementWork` / `markEngagementWorkFinished`); `COMPLETED` and
 * `CANCELLED` are in the enum but RESERVED — no transition into either
 * exists yet (GOS-113/114/117).
 */
registerEnumType(EngagementStatus, {
  name: 'EngagementStatus',
  description:
    'Work-execution lifecycle of an Engagement. ACCEPTED (set when a Quote is accepted) → IN_PROGRESS (Professional called startEngagementWork; requires a CONFIRMED Appointment) → PENDING_CUSTOMER_CONFIRMATION (Professional called markEngagementWorkFinished). COMPLETED and CANCELLED are reserved for GOS-113/114/117 — present in the enum, no transition into either yet.',
});

export { EngagementStatus };
