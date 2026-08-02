import { INestApplication } from '@nestjs/common';
import { AuthProvider, UserAccountStatus } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { hashVerificationCode } from '../src/users/services/verification-code.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanUsersData, createTestApp } from './support/test-app';

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
  };
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
});
