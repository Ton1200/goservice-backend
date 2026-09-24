import { EngagementStatus } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  readPostCompletionWindowHours,
  resolveEngagementChatClosure,
} from './resolve-engagement-chat-closure.util';

describe('resolve-engagement-chat-closure.util', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const completedAt = new Date('2026-09-20T12:00:00.000Z');

  describe('resolveEngagementChatClosure', () => {
    it('CANCELLED → read-only immediately, no closing time', () => {
      expect(
        resolveEngagementChatClosure(
          { status: EngagementStatus.CANCELLED, completedAt: null },
          48,
          new Date(),
        ),
      ).toEqual({ chatReadOnly: true, chatClosesAt: null });
    });

    it.each([
      EngagementStatus.ACCEPTED,
      EngagementStatus.IN_PROGRESS,
      EngagementStatus.PENDING_CUSTOMER_CONFIRMATION,
    ])('%s → writable, no closing time', (status) => {
      expect(
        resolveEngagementChatClosure(
          { status, completedAt: null },
          48,
          new Date(),
        ),
      ).toEqual({ chatReadOnly: false, chatClosesAt: null });
    });

    it('COMPLETED → closes at completedAt + window, writable until then', () => {
      const closesAt = new Date(completedAt.getTime() + 48 * HOUR_MS);

      expect(
        resolveEngagementChatClosure(
          { status: EngagementStatus.COMPLETED, completedAt },
          48,
          new Date(closesAt.getTime() - 1),
        ),
      ).toEqual({ chatReadOnly: false, chatClosesAt: closesAt });
    });

    it('COMPLETED → read-only from the exact closing instant on', () => {
      const closesAt = new Date(completedAt.getTime() + 48 * HOUR_MS);

      expect(
        resolveEngagementChatClosure(
          { status: EngagementStatus.COMPLETED, completedAt },
          48,
          closesAt,
        ),
      ).toEqual({ chatReadOnly: true, chatClosesAt: closesAt });
    });

    it('COMPLETED with a 0-hour window → read-only at completion', () => {
      expect(
        resolveEngagementChatClosure(
          { status: EngagementStatus.COMPLETED, completedAt },
          0,
          completedAt,
        ),
      ).toEqual({ chatReadOnly: true, chatClosesAt: completedAt });
    });

    it('COMPLETED without completedAt (legacy row) → read-only, no closing time', () => {
      expect(
        resolveEngagementChatClosure(
          { status: EngagementStatus.COMPLETED, completedAt: null },
          48,
          new Date(),
        ),
      ).toEqual({ chatReadOnly: true, chatClosesAt: null });
    });
  });

  describe('readPostCompletionWindowHours', () => {
    function portReturning(value: string | null) {
      const getValue = jest.fn().mockResolvedValue(value);
      return {
        port: { getValue } as unknown as PlatformSettingPort,
        getValue,
      };
    }

    it('reads customer.chat.post-completion-window-hours and returns its numeric value', async () => {
      const { port, getValue } = portReturning('72');

      await expect(readPostCompletionWindowHours(port)).resolves.toBe(72);
      expect(getValue).toHaveBeenCalledWith(
        'customer.chat.post-completion-window-hours',
      );
    });

    it('accepts 0', async () => {
      await expect(
        readPostCompletionWindowHours(portReturning('0').port),
      ).resolves.toBe(0);
    });

    it.each([null, '', '  ', 'abc', '-1', 'Infinity'])(
      'falls back to 48 when the stored value is %p',
      async (value) => {
        await expect(
          readPostCompletionWindowHours(portReturning(value).port),
        ).resolves.toBe(48);
      },
    );
  });
});
