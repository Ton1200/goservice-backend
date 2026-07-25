import { registerEnumType } from '@nestjs/graphql';

/**
 * Coarse health signal for a system component, exposed via GraphQL.
 * Deliberately just two values for this infra pilot — no partial/degraded
 * states are modeled since there's no real domain traffic yet to justify
 * finer granularity.
 */
export enum ServiceHealth {
  OK = 'OK',
  UNAVAILABLE = 'UNAVAILABLE',
}

registerEnumType(ServiceHealth, {
  name: 'ServiceHealth',
  description:
    'Coarse health status of a backend component (e.g. the database connection).',
});
