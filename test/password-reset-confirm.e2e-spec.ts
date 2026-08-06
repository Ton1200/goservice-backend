import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { hashPasswordResetCode } from '../src/password-reset/services/password-reset-code.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanUsersData, createTestApp } from './support/test-app';

const RESET_PASSWORD_MUTATION = `
  mutation ResetPassword($input: ResetPasswordInput!) {
    resetPassword(input: $input) {
      success
      errors { code message }
    }
  }
`;

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) { userId sessionToken }
  }
`;

const ME_QUERY = `
  query Me {
    me
  }
`;

interface ResetPasswordResponseBody {
  data?: {
    resetPassword: {
      success: boolean;
      errors: { code: string; message: string }[] | null;
    };
  };
  errors?: { message: string }[];
}

interface LoginResponseBody {
  data: { login: { userId: string; sessionToken: string } } | null;
  errors?: { extensions?: { code?: string } }[];
}

interface MeResponseBody {
  data: { me: string } | null;
  errors?: { extensions?: { code?: string } }[];
}

const OLD_PASSWORD = 'super-secret-old-1';
const NEW_PASSWORD = 'super-secret-new-1';

function uniqueEmail(): string {
  return `pwreset-confirm-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

/**
 * e2e coverage for `resetPassword` (GOS-9): anti-enumeration parity across
 * failure modes, real success (login with the new password afterward), and
 * the resolved session-revocation decision (a session token issued before
 * the reset must be rejected afterward) — see
 * `goservice-backend/docs/gos9-plan-tecnico.md` §9/§10/§11/§12.
 */
describe('GraphQL resetPassword (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanUsersData(prisma);
    // This suite drives the throttled `login`/`resetPassword` mutations
    // repeatedly — flush the shared Redis-backed throttle counters so this
    // suite doesn't leak a "throttled" state into whichever spec file runs
    // next in the same 60s window. Same pattern as `auth-login.e2e-spec.ts`.
    const redisConfig = app.get(ConfigService<AppConfig, true>).get('redis', {
      infer: true,
    });
    const redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
    });
    await redis.flushdb();
    await redis.quit();
    await app.close();
  });

  async function seedEligibleUser(): Promise<{
    email: string;
    userId: string;
  }> {
    const email = uniqueEmail();
    const passwordHash = await argon2.hash(OLD_PASSWORD, {
      type: argon2.argon2id,
    });
    const user = await prisma.user.create({
      data: {
        email,
        firstName: 'Jane',
        lastName: 'Doe',
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.EMAIL_VERIFIED,
      },
    });
    return { email, userId: user.id };
  }

  async function seedActiveCode(
    userId: string,
    code: string,
    options?: { expiresAt?: Date; attemptsCount?: number },
  ) {
    return prisma.passwordResetCode.create({
      data: {
        userId,
        codeHash: hashPasswordResetCode(code),
        expiresAt: options?.expiresAt ?? new Date(Date.now() + 15 * 60_000),
        attemptsCount: options?.attemptsCount ?? 0,
      },
    });
  }

  function resetPasswordRequest(input: {
    email: string;
    code: string;
    newPassword: string;
  }) {
    return request(app.getHttpServer())
      .post('/graphql')
      .send({ query: RESET_PASSWORD_MUTATION, variables: { input } })
      .expect(200);
  }

  async function login(
    email: string,
    password: string,
  ): Promise<LoginResponseBody> {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: LOGIN_MUTATION,
        variables: { input: { email, password } },
      })
      .expect(200);
    return response.body as LoginResponseBody;
  }

  async function me(sessionToken: string): Promise<MeResponseBody> {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: ME_QUERY })
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    return response.body as MeResponseBody;
  }

  const GENERIC_FAILURE = {
    success: false,
    errors: [
      {
        code: 'RESET_CODE_INVALID_OR_EXPIRED',
        message: expect.any(String) as unknown,
      },
    ],
  };

  it('fails generically for an unknown email', async () => {
    const response = await resetPasswordRequest({
      email: 'nobody-at-all@example.com',
      code: '123456',
      newPassword: NEW_PASSWORD,
    });
    const body = response.body as ResetPasswordResponseBody;

    expect(body.data?.resetPassword).toEqual(GENERIC_FAILURE);
  });

  it('fails generically for a social-only account, even with a plausible-looking code', async () => {
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
    await seedActiveCode(user.id, '123456');

    const response = await resetPasswordRequest({
      email,
      code: '123456',
      newPassword: NEW_PASSWORD,
    });
    const body = response.body as ResetPasswordResponseBody;

    expect(body.data?.resetPassword).toEqual(GENERIC_FAILURE);
  });

  it('fails generically for a non-login-eligible account (PENDING_EMAIL_VERIFICATION)', async () => {
    const email = uniqueEmail();
    const passwordHash = await argon2.hash(OLD_PASSWORD, {
      type: argon2.argon2id,
    });
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        acceptedTermsAndPrivacy: true,
        authProvider: AuthProvider.PASSWORD,
        accountStatus: UserAccountStatus.PENDING_EMAIL_VERIFICATION,
      },
    });
    await seedActiveCode(user.id, '123456');

    const response = await resetPasswordRequest({
      email,
      code: '123456',
      newPassword: NEW_PASSWORD,
    });
    const body = response.body as ResetPasswordResponseBody;

    expect(body.data?.resetPassword).toEqual(GENERIC_FAILURE);
  });

  it('fails generically with an incorrect code', async () => {
    const { email, userId } = await seedEligibleUser();
    await seedActiveCode(userId, '123456');

    const response = await resetPasswordRequest({
      email,
      code: '999999',
      newPassword: NEW_PASSWORD,
    });
    const body = response.body as ResetPasswordResponseBody;

    expect(body.data?.resetPassword).toEqual(GENERIC_FAILURE);
  });

  it('fails generically once the code has expired', async () => {
    const { email, userId } = await seedEligibleUser();
    await seedActiveCode(userId, '123456', {
      expiresAt: new Date(Date.now() - 1_000),
    });

    const response = await resetPasswordRequest({
      email,
      code: '123456',
      newPassword: NEW_PASSWORD,
    });
    const body = response.body as ResetPasswordResponseBody;

    expect(body.data?.resetPassword).toEqual(GENERIC_FAILURE);
  });

  it('fails generically once attemptsCount has reached the configured max (5)', async () => {
    const { email, userId } = await seedEligibleUser();
    await seedActiveCode(userId, '123456', { attemptsCount: 5 });

    const response = await resetPasswordRequest({
      email,
      code: '123456',
      newPassword: NEW_PASSWORD,
    });
    const body = response.body as ResetPasswordResponseBody;

    expect(body.data?.resetPassword).toEqual(GENERIC_FAILURE);
  });

  it('fails generically for a code that was already consumed (no replay)', async () => {
    const { email, userId } = await seedEligibleUser();
    await seedActiveCode(userId, '123456');

    const first = await resetPasswordRequest({
      email,
      code: '123456',
      newPassword: NEW_PASSWORD,
    });
    expect(
      (first.body as ResetPasswordResponseBody).data?.resetPassword,
    ).toEqual({ success: true, errors: [] });

    const second = await resetPasswordRequest({
      email,
      code: '123456',
      newPassword: 'yet-another-password-1',
    });
    const secondBody = second.body as ResetPasswordResponseBody;

    expect(secondBody.data?.resetPassword).toEqual(GENERIC_FAILURE);
  });

  it('rejects a malformed/manipulated (non-6-digit) code at the DTO validation layer', async () => {
    const { email, userId } = await seedEligibleUser();
    await seedActiveCode(userId, '123456');

    const response = await resetPasswordRequest({
      email,
      code: 'not-a-code',
      newPassword: NEW_PASSWORD,
    });

    expect(response.body).toHaveProperty('errors');
  });

  it('rejects a newPassword shorter than the minimum length at the DTO validation layer', async () => {
    const { email, userId } = await seedEligibleUser();
    await seedActiveCode(userId, '123456');

    const response = await resetPasswordRequest({
      email,
      code: '123456',
      newPassword: 'short',
    });

    expect(response.body).toHaveProperty('errors');
  });

  it('rejects mass-assignment of an unexpected field on ResetPasswordInput', async () => {
    const { email, userId } = await seedEligibleUser();
    await seedActiveCode(userId, '123456');

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: RESET_PASSWORD_MUTATION,
        variables: {
          input: {
            email,
            code: '123456',
            newPassword: NEW_PASSWORD,
            accountStatus: 'APPROVED', // not a declared ResetPasswordInput field
          },
        },
      });

    // Same rationale as `users-register.e2e-spec.ts`'s mass-assignment
    // test: GraphQL's own type system rejects an undeclared input field
    // before the resolver (and its ValidationPipe) ever runs — Apollo
    // Server returns this as an HTTP 400 (document validation failure),
    // unlike a resolver-level execution error (HTTP 200 with a populated
    // `errors` array) — assert on the error content, not a specific
    // transport status code.
    expect([200, 400]).toContain(response.status);
    expect(response.body).toHaveProperty('errors');
  });

  it(
    'rejects a newPassword equal to the current password with ' +
      'NEW_PASSWORD_SAME_AS_CURRENT, without burning the code — a ' +
      'subsequent attempt with a different password and the SAME code ' +
      'still succeeds',
    async () => {
      const { email, userId } = await seedEligibleUser();
      await seedActiveCode(userId, '111222');

      const sameAsCurrent = await resetPasswordRequest({
        email,
        code: '111222',
        newPassword: OLD_PASSWORD,
      });
      const sameAsCurrentBody = sameAsCurrent.body as ResetPasswordResponseBody;

      expect(sameAsCurrentBody.data?.resetPassword).toEqual({
        success: false,
        errors: [
          {
            code: 'NEW_PASSWORD_SAME_AS_CURRENT',
            message: expect.any(String) as unknown,
          },
        ],
      });

      // The old password still works — nothing was changed.
      const stillOldPasswordLogin = await login(email, OLD_PASSWORD);
      expect(stillOldPasswordLogin.data?.login.userId).toBe(userId);

      // The SAME code is still usable — retrying with a different password
      // succeeds.
      const retry = await resetPasswordRequest({
        email,
        code: '111222',
        newPassword: NEW_PASSWORD,
      });
      const retryBody = retry.body as ResetPasswordResponseBody;

      expect(retryBody.data?.resetPassword).toEqual({
        success: true,
        errors: [],
      });

      const newPasswordLogin = await login(email, NEW_PASSWORD);
      expect(newPasswordLogin.data?.login.userId).toBe(userId);
    },
  );

  it(
    'succeeds end-to-end: updates the password hash, consumes the code, ' +
      'allows a subsequent login with the new password, and revokes a ' +
      'session token issued before the reset',
    async () => {
      const { email, userId } = await seedEligibleUser();

      // A real session, issued BEFORE the reset, via the real `login`
      // mutation — this is the token that must stop working afterward.
      const preResetLogin = await login(email, OLD_PASSWORD);
      const preResetSessionToken = preResetLogin.data!.login.sessionToken;
      const preResetMe = await me(preResetSessionToken);
      expect(preResetMe.data?.me).toBe(userId);

      await seedActiveCode(userId, '654321');

      const response = await resetPasswordRequest({
        email,
        code: '654321',
        newPassword: NEW_PASSWORD,
      });
      const body = response.body as ResetPasswordResponseBody;

      expect(body.data?.resetPassword).toEqual({ success: true, errors: [] });

      // The old password no longer works.
      const oldPasswordLogin = await login(email, OLD_PASSWORD);
      expect(oldPasswordLogin.data).toBeNull();
      expect(oldPasswordLogin.errors?.[0]?.extensions?.code).toBe(
        'AUTHENTICATION_FAILED',
      );

      // The new password works and issues a fresh session.
      const newPasswordLogin = await login(email, NEW_PASSWORD);
      expect(newPasswordLogin.data?.login.userId).toBe(userId);

      // The pre-reset session token is now rejected.
      const postResetMe = await me(preResetSessionToken);
      expect(postResetMe.data).toBeNull();
      expect(postResetMe.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');

      // The pre-reset session row itself is REVOKED; only the post-reset
      // login's session remains ACTIVE.
      const sessions = await prisma.session.findMany({ where: { userId } });
      expect(sessions.filter((s) => s.status === 'ACTIVE')).toHaveLength(1);
      expect(sessions.filter((s) => s.status === 'REVOKED')).toHaveLength(1);
    },
  );
});
