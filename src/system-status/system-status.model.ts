import { Field, GraphQLISODateTime, ObjectType } from '@nestjs/graphql';
import { ServiceHealth } from './service-health.enum';

/**
 * Infra-only pilot type: proves Expo -> GraphQL -> NestJS -> PostgreSQL
 * connectivity end-to-end. Not a GoService domain entity — see
 * goservice-docs/architecture/backend.md for the domain-module rules this
 * type is deliberately outside of.
 */
@ObjectType()
export class SystemStatus {
  @Field(() => ServiceHealth, {
    description:
      'Whether the backend process itself is up (always OK if this field resolves at all).',
  })
  backendStatus!: ServiceHealth;

  @Field(() => ServiceHealth, {
    description:
      'Whether a live SELECT 1 against PostgreSQL succeeded at request time.',
  })
  databaseStatus!: ServiceHealth;

  @Field(() => GraphQLISODateTime, {
    description: 'Server clock time at which this status was computed.',
  })
  serverTimestamp!: Date;
}
