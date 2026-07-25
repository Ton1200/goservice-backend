import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ServiceHealth } from './service-health.enum';
import { SystemStatus } from './system-status.model';

/**
 * Application service: the only place this pilot's "is everything up"
 * orchestration logic lives. The resolver stays a thin delivery adapter
 * that just calls this.
 */
@Injectable()
export class SystemStatusService {
  constructor(private readonly databaseService: DatabaseService) {}

  async getSystemStatus(): Promise<SystemStatus> {
    // Reaching this line at all means the backend process/GraphQL layer is
    // up, so backendStatus is unconditionally OK here.
    const isDatabaseReachable = await this.databaseService.checkConnection();

    return {
      backendStatus: ServiceHealth.OK,
      databaseStatus: isDatabaseReachable
        ? ServiceHealth.OK
        : ServiceHealth.UNAVAILABLE,
      serverTimestamp: new Date(),
    };
  }
}
