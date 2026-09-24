import { EngagementStatus } from '@prisma/client';
import { EngagementModel } from '../engagements/models/engagement.model';
import { PlatformSettingPort } from '../platform-admin/platform-settings/ports/platform-setting.port';
import { EngagementChatClosureFieldResolver } from './engagement-chat-closure-field.resolver';

describe('EngagementChatClosureFieldResolver', () => {
  const HOUR_MS = 60 * 60 * 1000;

  function makeResolver(windowHours: string | null = '48') {
    const getValue = jest.fn().mockResolvedValue(windowHours);
    const resolver = new EngagementChatClosureFieldResolver({
      getValue,
    } as unknown as PlatformSettingPort);
    return { resolver, getValue };
  }

  function makeEngagement(
    status: EngagementStatus,
    completedAt: Date | null = null,
  ): EngagementModel {
    return { id: 'engagement-1', status, completedAt } as EngagementModel;
  }

  it('a COMPLETED Engagement inside the window is writable and exposes the server-computed closing instant', async () => {
    const completedAt = new Date(Date.now() - 1 * HOUR_MS);
    const { resolver } = makeResolver('48');
    const engagement = makeEngagement(EngagementStatus.COMPLETED, completedAt);

    await expect(resolver.chatReadOnly(engagement)).resolves.toBe(false);
    await expect(resolver.chatClosesAt(engagement)).resolves.toEqual(
      new Date(completedAt.getTime() + 48 * HOUR_MS),
    );
  });

  it('a COMPLETED Engagement past the window is read-only', async () => {
    const { resolver } = makeResolver('2');

    await expect(
      resolver.chatReadOnly(
        makeEngagement(
          EngagementStatus.COMPLETED,
          new Date(Date.now() - 3 * HOUR_MS),
        ),
      ),
    ).resolves.toBe(true);
  });

  it('a CANCELLED Engagement is read-only with no closing instant', async () => {
    const { resolver } = makeResolver();
    const engagement = makeEngagement(EngagementStatus.CANCELLED);

    await expect(resolver.chatReadOnly(engagement)).resolves.toBe(true);
    await expect(resolver.chatClosesAt(engagement)).resolves.toBeNull();
  });

  it('an open Engagement is writable with no closing instant', async () => {
    const { resolver } = makeResolver();
    const engagement = makeEngagement(EngagementStatus.IN_PROGRESS);

    await expect(resolver.chatReadOnly(engagement)).resolves.toBe(false);
    await expect(resolver.chatClosesAt(engagement)).resolves.toBeNull();
  });
});
