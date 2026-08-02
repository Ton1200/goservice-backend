import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import request from 'supertest';
import type { Response } from 'supertest';
import type { App } from 'supertest/types';
import type { AppConfig } from '../src/config/configuration';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanUsersData, createTestApp } from './support/test-app';

const VERIFY_MUTATION = `
  mutation VerifyEmailCode($input: VerifyEmailCodeInput!) {
    verifyEmailCode(input: $input) {
      success
    }
  }
`;

const LOGIN_MUTATION = `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      userId
    }
  }
`;

interface VerifyEmailCodeThrottleResponseBody {
  errors?: { message?: string }[];
}

/**
 * Exercises the REAL Redis-backed `@nestjs/throttler` layer against a
 * brute-force-style burst of requests. This is an ADDITIONAL raw-request-
 * rate control — see `users.resolver.ts`'s `@Throttle` limits and the
 * comment there about the DB-durable `attemptsCount`/cooldown being the
 * PRIMARY control for `verifyEmailCode`/`resendVerificationCode`.
 */
describe('GraphQL rate limiting (e2e, real Redis)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await cleanUsersData(prisma);
    // This suite deliberately exhausts the shared Redis-backed throttle
    // counters (same keys other e2e spec files' `verifyEmailCode` calls
    // use, since the throttler key is derived from class+handler+tracker,
    // not per-test-run) — flush them here so this suite doesn't leak a
    // "throttled" state into whichever spec file happens to run next in
    // the same 60s window.
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

  it('throttles a burst of verifyEmailCode requests from the same client beyond its configured limit', async () => {
    const responses: Response[] = [];
    // The resolver's verifyEmailCode limit is 20/60s; send comfortably more
    // than that so throttling is exercised even if a prior spec file in
    // this run already consumed part of the same 60s window.
    for (let i = 0; i < 30; i++) {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: VERIFY_MUTATION,
          variables: {
            input: { email: 'brute-force@example.com', code: '000000' },
          },
        });
      responses.push(response);
    }

    const throttled = responses.filter((response) => {
      if (response.status === 429) {
        return true;
      }
      const body = response.body as VerifyEmailCodeThrottleResponseBody;
      return (body.errors ?? []).some((error) =>
        /too many requests|throttl/i.test(error.message ?? ''),
      );
    });

    expect(throttled.length).toBeGreaterThan(0);
  }, 30_000);

  it('throttles a burst of login requests from the same client beyond its configured limit', async () => {
    const responses: Response[] = [];
    // The resolver's login limit is 10/60s; send comfortably more than
    // that so throttling is exercised even if a prior spec file in this
    // run already consumed part of the same 60s window.
    for (let i = 0; i < 20; i++) {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: LOGIN_MUTATION,
          variables: {
            input: {
              email: 'brute-force-login@example.com',
              password: 'wrong-password',
            },
          },
        });
      responses.push(response);
    }

    const throttled = responses.filter((response) => {
      if (response.status === 429) {
        return true;
      }
      const body = response.body as VerifyEmailCodeThrottleResponseBody;
      return (body.errors ?? []).some((error) =>
        /too many requests|throttl/i.test(error.message ?? ''),
      );
    });

    expect(throttled.length).toBeGreaterThan(0);
  }, 30_000);
});
