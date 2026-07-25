import { Query, Resolver } from '@nestjs/graphql';
import { SystemStatus } from './system-status.model';
import { SystemStatusService } from './system-status.service';

/**
 * Thin delivery adapter — no business logic here. See
 * goservice-docs/architecture/backend.md's "resolvers are delivery
 * adapters" rule.
 */
@Resolver(() => SystemStatus)
export class SystemStatusResolver {
  constructor(private readonly systemStatusService: SystemStatusService) {}

  @Query(() => SystemStatus, {
    name: 'systemStatus',
    description:
      'Infra pilot health check: backend process status and a live PostgreSQL connectivity check.',
  })
  systemStatus(): Promise<SystemStatus> {
    return this.systemStatusService.getSystemStatus();
  }
}
