import { INestApplication } from '@nestjs/common';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { hashVerificationCode } from '../src/users/services/verification-code.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanUsersData, createTestApp } from './support/test-app';

const VERIFY_MUTATION = `
  mutation VerifyEmailCode($input: VerifyEmailCodeInput!) {
    verifyEmailCode(input: $input) {
      success
      errors { code message }
    }
  }
`;

interface VerifyEmailCodeResponseBody {
  data?: {
    verifyEmailCode: {
      success: boolean;
      errors: { code: string; message: string }[];
    };
  };
  errors?: { message: string }[];
}

function uniqueEmail(): string {
  return `verify-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

describe('GraphQL verifyEmailCode (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanUsersData(prisma);
    await app.close();
  });

  async function seedPendingUserWithCode(options: {
    code: string;
    expiresAt: Date;
    attemptsCount?: number;
  }) {
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
        codeHash: hashVerificationCode(options.code),
        expiresAt: options.expiresAt,
        attemptsCount: options.attemptsCount ?? 0,
      },
    });
    return { email, userId: user.id };
  }

  it('succeeds with the correct code and marks the user EMAIL_VERIFIED', async () => {
    const { email, userId } = await seedPendingUserWithCode({
      code: '123456',
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: VERIFY_MUTATION,
        variables: { input: { email, code: '123456' } },
      })
      .expect(200);
    const body = response.body as VerifyEmailCodeResponseBody;

    expect(body.data?.verifyEmailCode).toEqual({ success: true, errors: [] });

    const updated = await prisma.user.findUnique({ where: { id: userId } });
    expect(updated?.accountStatus).toBe(UserAccountStatus.EMAIL_VERIFIED);
  });

  it('fails generically with an incorrect code, without revealing the reason', async () => {
    const { email } = await seedPendingUserWithCode({
      code: '123456',
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: VERIFY_MUTATION,
        variables: { input: { email, code: '999999' } },
      })
      .expect(200);
    const body = response.body as VerifyEmailCodeResponseBody;

    expect(body.data?.verifyEmailCode).toEqual({
      success: false,
      errors: [
        {
          code: 'CODE_INVALID_OR_EXPIRED',
          message: expect.any(String) as unknown,
        },
      ],
    });
  });

  it('fails generically for an unknown email (never distinguishes from wrong code)', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: VERIFY_MUTATION,
        variables: {
          input: { email: 'nobody-at-all@example.com', code: '123456' },
        },
      })
      .expect(200);
    const body = response.body as VerifyEmailCodeResponseBody;

    expect(body.data?.verifyEmailCode).toEqual({
      success: false,
      errors: [
        {
          code: 'CODE_INVALID_OR_EXPIRED',
          message: expect.any(String) as unknown,
        },
      ],
    });
  });

  it('fails generically once the code has expired', async () => {
    const { email } = await seedPendingUserWithCode({
      code: '123456',
      expiresAt: new Date(Date.now() - 1_000),
    });

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: VERIFY_MUTATION,
        variables: { input: { email, code: '123456' } },
      })
      .expect(200);
    const body = response.body as VerifyEmailCodeResponseBody;

    expect(body.data?.verifyEmailCode.success).toBe(false);
    expect(body.data?.verifyEmailCode.errors[0].code).toBe(
      'CODE_INVALID_OR_EXPIRED',
    );
  });

  it('fails generically once attemptsCount has reached the configured max (5)', async () => {
    const { email } = await seedPendingUserWithCode({
      code: '123456',
      expiresAt: new Date(Date.now() + 15 * 60_000),
      attemptsCount: 5,
    });

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: VERIFY_MUTATION,
        variables: { input: { email, code: '123456' } },
      })
      .expect(200);
    const body = response.body as VerifyEmailCodeResponseBody;

    expect(body.data?.verifyEmailCode.success).toBe(false);
    expect(body.data?.verifyEmailCode.errors[0].code).toBe(
      'CODE_INVALID_OR_EXPIRED',
    );
  });

  it('rejects a malformed (non-6-digit) code at the DTO validation layer', async () => {
    const { email } = await seedPendingUserWithCode({
      code: '123456',
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({
        query: VERIFY_MUTATION,
        variables: { input: { email, code: 'abc' } },
      })
      .expect(200);
    const body = response.body as VerifyEmailCodeResponseBody;

    expect(body.errors).toBeDefined();
  });
});
