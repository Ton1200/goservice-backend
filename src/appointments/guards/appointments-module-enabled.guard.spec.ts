import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { AppointmentsModuleEnabledGuard } from './appointments-module-enabled.guard';

describe('AppointmentsModuleEnabledGuard', () => {
  function makeGuard(enabled: boolean) {
    const isEnabled = jest.fn().mockResolvedValue(enabled);
    const platformSettingPort = { isEnabled } as unknown as PlatformSettingPort;
    const guard = new AppointmentsModuleEnabledGuard(platformSettingPort);
    return { guard, isEnabled };
  }

  it('allows the request through when customer.appointments.enabled is true — applies uniformly to every gated operation, since this guard is applied at the resolver class level (proposeAppointment/acceptAppointment/cancelAppointment/appointmentsByEngagement share this ONE guard instance)', async () => {
    const { guard, isEnabled } = makeGuard(true);

    await expect(guard.canActivate()).resolves.toBe(true);
    expect(isEnabled).toHaveBeenCalledWith('customer.appointments.enabled');
  });

  it('throws APPOINTMENTS_MODULE_DISABLED when the flag is false — blocks every operation, since none can execute without this guard passing first', async () => {
    const { guard } = makeGuard(false);

    await expect(guard.canActivate()).rejects.toMatchObject({
      code: 'APPOINTMENTS_MODULE_DISABLED',
    });
  });
});
