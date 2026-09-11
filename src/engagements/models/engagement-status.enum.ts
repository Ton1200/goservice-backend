import { registerEnumType } from '@nestjs/graphql';
import { EngagementStatus } from '@prisma/client';

/**
 * Registers the Prisma-generated `EngagementStatus` enum directly as a
 * GraphQL enum type. GOS-111 grew this from a single value to the
 * work-execution state machine — see `prisma/schema.prisma`'s own comment.
 * `ACCEPTED → IN_PROGRESS → PENDING_CUSTOMER_CONFIRMATION` are the
 * Professional-driven transitions implemented by GOS-111
 * (`startEngagementWork` / `markEngagementWorkFinished`); `PENDING_CUSTOMER_CONFIRMATION
 * → COMPLETED` is the Customer-driven transition implemented by GOS-113
 * (`confirmEngagementCompletion`). `ACCEPTED|IN_PROGRESS → CANCELLED` is the
 * Customer-driven transition implemented by GOS-114
 * (`cancelEngagementByCustomer`); a Professional/other-initiated path into
 * `CANCELLED` remains reserved, no transition yet (GOS-117).
 */
registerEnumType(EngagementStatus, {
  name: 'EngagementStatus',
  description:
    'Work-execution lifecycle of an Engagement. ACCEPTED (set when a Quote is accepted) → IN_PROGRESS (Professional called startEngagementWork; requires a CONFIRMED Appointment) → PENDING_CUSTOMER_CONFIRMATION (Professional called markEngagementWorkFinished) → COMPLETED (Customer called confirmEngagementCompletion, GOS-113). ACCEPTED/IN_PROGRESS → CANCELLED (Customer called cancelEngagementByCustomer, GOS-114); a Professional/other-initiated cancellation path remains reserved (GOS-117).',
});

export { EngagementStatus };
