import { registerEnumType } from '@nestjs/graphql';
import { ServiceRequestUrgency } from '@prisma/client';

/**
 * Registers the Prisma-generated `ServiceRequestUrgency` enum directly as a
 * GraphQL enum type. Values as proposed by the GOS-38 ticket
 * (`FLEXIBLE`/`THIS_WEEK`/`URGENT`) — NOT confirmed against
 * `ubiquitous-language.md`/`business-rules.md` (no urgency taxonomy is
 * documented anywhere in this project). Used as given, no extra values
 * added — pending explicit product sign-off (see the GOS-38 plan's
 * "Decisiones pendientes").
 */
registerEnumType(ServiceRequestUrgency, {
  name: 'ServiceRequestUrgency',
  description:
    'How soon the Customer needs the work done. Values proposed by GOS-38, pending product confirmation.',
});

export { ServiceRequestUrgency };
