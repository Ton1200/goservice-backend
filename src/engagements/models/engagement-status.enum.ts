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
 * (`confirmEngagementCompletion`). `CANCELLED` remains in the enum but
 * RESERVED — no transition into it exists yet (GOS-114/117).
 */
registerEnumType(EngagementStatus, {
  name: 'EngagementStatus',
  description:
    'Work-execution lifecycle of an Engagement. ACCEPTED (set when a Quote is accepted) → IN_PROGRESS (Professional called startEngagementWork; requires a CONFIRMED Appointment) → PENDING_CUSTOMER_CONFIRMATION (Professional called markEngagementWorkFinished) → COMPLETED (Customer called confirmEngagementCompletion, GOS-113). CANCELLED remains reserved for GOS-114/117 — present in the enum, no transition into it yet.',
});

export { EngagementStatus };
