import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { RESEND_PLATFORM_SETTING_KEYS } from '../src/email/constants/resend-settings.constants';
import { hashPasswordResetCode } from '../src/password-reset/services/password-reset-code.util';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanUsersData,
  createTestApp,
  enableTestEmailDelivery,
} from './support/test-app';

const REQUEST_RESET_MUTATION = `
  mutation RequestPasswordReset($email: String!) {
    requestPasswordReset(email: $email) {
      requested
    }
  }
`;

interface RequestPasswordResetResponseBody {
  data?: { requestPasswordReset: { requested: boolean } } | null;
  errors?: { message?: string; extensions?: { code?: string } }[];
}

function uniqueEmail(): string {
  return `pwreset-request-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/**
 * e2e coverage for `requestPasswordReset` (GOS-9), focused on the resolved
 * anti-enumeration behavior: nonexistent email, social-only account, and a
 * non-login-eligible `accountStatus` must all be externally
 * indistinguishable from a real, eligible account's request — see
 * `goservice-backend/docs/gos9-plan-tecnico.md` §9/§10/§12.
 */
describe('GraphQL requestPasswordReset (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    // `requestPasswordReset` now gates on email-delivery availability first
    // (GOS-3x follow-up) — see `enableTestEmailDelivery`'s own doc comment.
    await enableTestEmailDelivery(prisma);

    const redisConfig = app.get(ConfigService<AppConfig, true>).get('redis', {
      infer: true,
    });
    redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
    });
  });

  // `requestPasswordReset`'s own resolver-level throttle is 5 requests/60s
  // (see `password-reset.resolver.ts`) — this suite's own test cases alone
  // call it more than 5 times, so (unlike most other e2e spec files, which
  // only flush once in `afterAll` to avoid leaking state into the NEXT
  // spec file) this one also flushes BEFORE each of its own tests, so a
  // test doesn't spuriously get throttled by ITS OWN suite's prior cases.
  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await cleanUsersData(prisma);
    // Same rationale as the per-test flush above, but for whichever spec
    // file runs next in the same 60s window. Same pattern as
    // `auth-login.e2e-spec.ts`.
    await redis.flushdb();
    await redis.quit();
    await app.close();
  });

  async function seedEligibleUser(): Promise<{
    email: string;
    userId: string;
  }> {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        passwordHash: 'irrelevant-hash-for-this-suite',
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });
    return { email, userId: user.id };
  }

  async function seedSocialOnlyUser(): Promise<{
    email: string;
    userId: string;
  }> {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        authProvider: AuthProvider.GOOGLE,
        socialProviderSubject: `google-subject-${Date.now()}`,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
        acceptedTermsAndPrivacy: true,
        passwordHash: null,
      },
    });
    return { email, userId: user.id };
  }

  async function seedIneligibleUser(
    accountStatus: UserAccountStatus,
  ): Promise<{ email: string; userId: string }> {
    const email = uniqueEmail();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'irrelevant-hash-for-this-suite',
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus,
      },
    });
    return { email, userId: user.id };
  }

  function requestPasswordResetRequest(email: string) {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({ query: REQUEST_RESET_MUTATION, variables: { email } })
      .expect(200);
  }

  it('returns requested:true for a non-existent email (anti-enumeration)', async () => {
    const response = await requestPasswordResetRequest(
      'no-such-user@example.com',
    );
    const body = response.body as RequestPasswordResetResponseBody;

    expect(body.data?.requestPasswordReset).toEqual({ requested: true });
  });

  it('returns requested:true and creates no code for a social-only account', async () => {
    const { email, userId } = await seedSocialOnlyUser();

    const response = await requestPasswordResetRequest(email);
    const body = response.body as RequestPasswordResetResponseBody;

    expect(body.data?.requestPasswordReset).toEqual({ requested: true });
    await expect(
      prisma.passwordResetCode.findMany({ where: { userId } }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    UserAccountStatus.PENDING_EMAIL_VERIFICATION,
    UserAccountStatus.PENDING_APPROVAL,
    UserAccountStatus.REJECTED,
  ])(
    'returns requested:true and creates no code for a non-login-eligible account (%s)',
    async (accountStatus) => {
      const { email, userId } = await seedIneligibleUser(accountStatus);

      const response = await requestPasswordResetRequest(email);
      const body = response.body as RequestPasswordResetResponseBody;

      expect(body.data?.requestPasswordReset).toEqual({ requested: true });
      await expect(
        prisma.passwordResetCode.findMany({ where: { userId } }),
      ).resolves.toHaveLength(0);
    },
  );

  it('creates a real PasswordResetCode for an eligible account and returns requested:true', async () => {
    const { email, userId } = await seedEligibleUser();

    const response = await requestPasswordResetRequest(email);
    const body = response.body as RequestPasswordResetResponseBody;

    expect(body.data?.requestPasswordReset).toEqual({ requested: true });
    const codes = await prisma.passwordResetCode.findMany({
      where: { userId, consumedAt: null, invalidatedAt: null },
    });
    expect(codes).toHaveLength(1);
  });

  it('is idempotent within the cooldown for a real eligible user (does not create a new code row)', async () => {
    const { email, userId } = await seedEligibleUser();
    await prisma.passwordResetCode.create({
      data: {
        userId,
        codeHash: hashPasswordResetCode('123456'),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });

    const before = await prisma.passwordResetCode.count({
      where: { userId },
    });

    const response = await requestPasswordResetRequest(email);
    const body = response.body as RequestPasswordResetResponseBody;

    expect(body.data?.requestPasswordReset).toEqual({ requested: true });
    const after = await prisma.passwordResetCode.count({ where: { userId } });
    expect(after).toBe(before); // no new code issued, still within cooldown
  });

  it('issues a new code once the cooldown has elapsed, invalidating the prior one', async () => {
    const { email, userId } = await seedEligibleUser();
    await prisma.passwordResetCode.create({
      data: {
        userId,
        codeHash: hashPasswordResetCode('123456'),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
    await prisma.passwordResetCode.updateMany({
      where: { userId },
      data: { createdAt: new Date(Date.now() - 120_000) }, // past 60s cooldown
    });

    const response = await requestPasswordResetRequest(email);
    const body = response.body as RequestPasswordResetResponseBody;

    expect(body.data?.requestPasswordReset).toEqual({ requested: true });
    const activeCodes = await prisma.passwordResetCode.findMany({
      where: { userId, consumedAt: null, invalidatedAt: null },
    });
    expect(activeCodes).toHaveLength(1);
    expect(activeCodes[0].codeHash).not.toBe(hashPasswordResetCode('123456'));
  });

  /**
   * GOS-3x follow-up reference case, proven at the API layer: a disabled
   * `notifications.email.resend.enabled` `PlatformSetting` rejects
   * `requestPasswordReset` with the distinct `EMAIL_DELIVERY_DISABLED`
   * code — checked BEFORE the `findByEmail` lookup, so a nonexistent email
   * and a real, eligible email get the IDENTICAL error/result, preserving
   * this mutation's own anti-enumeration guarantee (see the describe
   * block's own top-level doc comment). Restores the setting afterward so
   * this suite never leaks state into other e2e files — same pattern as
   * `test/auth-social-login.e2e-spec.ts`'s own gate describe block.
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

      const response = await requestPasswordResetRequest(
        'no-such-user@example.com',
      );
      const body = response.body as RequestPasswordResetResponseBody;

      expect(body.data).toBeNull();
      expect(body.errors?.[0].extensions?.code).toBe('EMAIL_DELIVERY_DISABLED');
    });

    it('rejects a REAL, eligible email with the IDENTICAL EMAIL_DELIVERY_DISABLED error, creating no code — anti-enumeration proof', async () => {
      await prisma.platformSetting.update({
        where: { key: RESEND_PLATFORM_SETTING_KEYS.enabled },
        data: { value: 'false' },
      });

      const { email, userId } = await seedEligibleUser();

      const [unknownResponse, realResponse] = await Promise.all([
        requestPasswordResetRequest('still-nobody@example.com'),
        requestPasswordResetRequest(email),
      ]);
      const unknownBody =
        unknownResponse.body as RequestPasswordResetResponseBody;
      const realBody = realResponse.body as RequestPasswordResetResponseBody;

      expect(unknownBody.data).toBeNull();
      expect(realBody.data).toBeNull();
      expect(realBody.errors?.[0].extensions?.code).toBe(
        'EMAIL_DELIVERY_DISABLED',
      );
      expect(realBody.errors?.[0].extensions?.code).toBe(
        unknownBody.errors?.[0].extensions?.code,
      );
      expect(realBody.errors?.[0].message).toBe(
        unknownBody.errors?.[0].message,
      );
      await expect(
        prisma.passwordResetCode.findMany({ where: { userId } }),
      ).resolves.toHaveLength(0);
    });

    it('succeeds again once email delivery is re-enabled', async () => {
      await enableTestEmailDelivery(prisma);

      const response = await requestPasswordResetRequest(
        'no-such-user@example.com',
      );
      const body = response.body as RequestPasswordResetResponseBody;

      expect(body.errors).toBeUndefined();
      expect(body.data?.requestPasswordReset).toEqual({ requested: true });
    });
  });
});
