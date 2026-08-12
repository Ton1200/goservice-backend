import { INestApplication } from '@nestjs/common';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { RESEND_PLATFORM_SETTING_KEYS } from '../src/email/constants/resend-settings.constants';
import { hashVerificationCode } from '../src/users/services/verification-code.util';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanUsersData,
  createTestApp,
  enableTestEmailDelivery,
} from './support/test-app';

const RESEND_MUTATION = `
  mutation ResendVerificationCode($email: String!) {
    resendVerificationCode(email: $email) {
      resent
      nextResendAvailableAt
    }
  }
`;

interface ResendResponseBody {
  data?: {
    resendVerificationCode: { resent: boolean; nextResendAvailableAt: string };
  } | null;
  errors?: { message?: string; extensions?: { code?: string } }[];
}

function uniqueEmail(): string {
  return `resend-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe('GraphQL resendVerificationCode (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    // `resendVerificationCode` now gates on email-delivery availability
    // first (GOS-3x follow-up) — see `enableTestEmailDelivery`'s own doc
    // comment.
    await enableTestEmailDelivery(prisma);
  });

  afterAll(async () => {
    await cleanUsersData(prisma);
    await app.close();
  });

  it('always returns resent: true for a non-existent email (anti-enumeration)', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: RESEND_MUTATION,
        variables: { email: 'no-such-user@example.com' },
      })
      .expect(200);
    const body = response.body as ResendResponseBody;

    expect(body.data?.resendVerificationCode.resent).toBe(true);
    expect(
      Number.isNaN(
        Date.parse(
          body.data?.resendVerificationCode.nextResendAvailableAt ?? '',
        ),
      ),
    ).toBe(false);
  });

  it('is idempotent within the cooldown for a real pending user (does not create a new code row)', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.PENDING_EMAIL_VERIFICATION,
        acceptedTermsAndPrivacy: true,
      },
    });
    await prisma.emailVerificationCode.create({
      data: {
        userId: user.id,
        codeHash: hashVerificationCode('123456'),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });

    const before = await prisma.emailVerificationCode.count({
      where: { userId: user.id },
    });

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: RESEND_MUTATION, variables: { email } })
      .expect(200);
    const body = response.body as ResendResponseBody;

    expect(body.data?.resendVerificationCode.resent).toBe(true);

    const after = await prisma.emailVerificationCode.count({
      where: { userId: user.id },
    });
    expect(after).toBe(before); // no new code issued, still within cooldown
  });

  it('issues a new code once the cooldown has elapsed for a real pending user', async () => {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.PENDING_EMAIL_VERIFICATION,
        acceptedTermsAndPrivacy: true,
      },
    });
    await prisma.emailVerificationCode.create({
      data: {
        userId: user.id,
        codeHash: hashVerificationCode('123456'),
        expiresAt: new Date(Date.now() + 15 * 60_000),
        // createdAt cannot be set directly on create with @default(now());
        // simulate an elapsed cooldown by updating it right after.
      },
    });
    await prisma.emailVerificationCode.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 120_000) },
    });

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: RESEND_MUTATION, variables: { email } })
      .expect(200);
    const body = response.body as ResendResponseBody;

    expect(body.data?.resendVerificationCode.resent).toBe(true);

    const activeCodes = await prisma.emailVerificationCode.findMany({
      where: { userId: user.id, consumedAt: null, invalidatedAt: null },
    });
    expect(activeCodes).toHaveLength(1);
    expect(activeCodes[0].codeHash).not.toBe(hashVerificationCode('123456'));
  });

  /**
   * GOS-3x follow-up reference case, proven at the API layer: a disabled
   * `notifications.email.resend.enabled` `PlatformSetting` rejects
   * `resendVerificationCode` with the distinct `EMAIL_DELIVERY_DISABLED`
   * code — checked before any account lookup, so it fires identically for
   * both a real and a nonexistent email (same anti-enumeration reasoning as
   * `test/password-reset-request.e2e-spec.ts`'s equivalent block). Restores
   * the setting afterward so this suite never leaks state into other e2e
   * files.
   */
  describe('EnsureEmailDeliveryAvailableService gate (notifications.email.resend.enabled)', () => {
    afterEach(async () => {
      await enableTestEmailDelivery(prisma);
    });

    it('rejects with EMAIL_DELIVERY_DISABLED for a nonexistent email when email delivery is disabled', async () => {
      await prisma.platformSetting.update({
        where: { key: RESEND_PLATFORM_SETTING_KEYS.enabled },
        data: { value: 'false' },
      });

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: RESEND_MUTATION,
          variables: { email: 'no-such-user@example.com' },
        })
        .expect(200);
      const body = response.body as ResendResponseBody;

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('EMAIL_DELIVERY_DISABLED');
    });

    it('succeeds again once email delivery is re-enabled', async () => {
      await enableTestEmailDelivery(prisma);

      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: RESEND_MUTATION,
          variables: { email: 'no-such-user@example.com' },
        })
        .expect(200);
      const body = response.body as ResendResponseBody;

      expect(body.errors).toBeUndefined();
      expect(body.data?.resendVerificationCode.resent).toBe(true);
    });
  });
});
