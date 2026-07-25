import { DatabaseService } from '../database/database.service';
import { ServiceHealth } from './service-health.enum';
import { SystemStatusService } from './system-status.service';

describe('SystemStatusService', () => {
  function makeService(databaseReachable: boolean) {
    const databaseService = {
      checkConnection: jest.fn().mockResolvedValue(databaseReachable),
    } as unknown as DatabaseService;
    return new SystemStatusService(databaseService);
  }

  it('reports backendStatus OK and databaseStatus OK when the DB check succeeds', async () => {
    const service = makeService(true);

    const status = await service.getSystemStatus();

    expect(status.backendStatus).toBe(ServiceHealth.OK);
    expect(status.databaseStatus).toBe(ServiceHealth.OK);
    expect(status.serverTimestamp).toBeInstanceOf(Date);
  });

  it('reports databaseStatus UNAVAILABLE when the DB check fails, without throwing', async () => {
    const service = makeService(false);

    const status = await service.getSystemStatus();

    expect(status.backendStatus).toBe(ServiceHealth.OK);
    expect(status.databaseStatus).toBe(ServiceHealth.UNAVAILABLE);
  });
});
