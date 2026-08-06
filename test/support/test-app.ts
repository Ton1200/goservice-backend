import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SOCIAL_AUTH_PROVIDER_CONFIG } from '../../src/auth/config/social-auth-provider.config';
import type { SocialAuthProviderConfigMap } from '../../src/auth/config/social-auth-provider.config';

export interface TestAppContext {
  app: INestApplication<App>;
  prisma: PrismaService;
}

/**
 * Builds a real Nest application (`AppModule`, real Postgres via Prisma,
 * real Redis via `@nestjs/throttler`) for GraphQL e2e tests — same pattern
 * as the pre-existing `test/app.e2e-spec.ts`. Also replicates `main.ts`'s
 * global `ValidationPipe`, since `TestingModule`/`createNestApplication()`
 * bypasses `main.ts`'s own `bootstrap()`.
 *
 * `socialAuthProviderConfig`, when provided, overrides
 * `SOCIAL_AUTH_PROVIDER_CONFIG` so `socialLogin` tests can point at a
 * locally-served JWKS instead of real Google/Apple infrastructure — this is
 * the DI seam described in the GOS-22 plan.
 */
export async function createTestApp(options?: {
  socialAuthProviderConfig?: SocialAuthProviderConfigMap;
}): Promise<TestAppContext> {
  let moduleBuilder = Test.createTestingModule({ imports: [AppModule] });

  if (options?.socialAuthProviderConfig) {
    moduleBuilder = moduleBuilder
      .overrideProvider(SOCIAL_AUTH_PROVIDER_CONFIG)
      .useValue(options.socialAuthProviderConfig);
  }

  const moduleFixture: TestingModule = await moduleBuilder.compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  const prisma = app.get(PrismaService);
  return { app, prisma };
}

/** Deletes all users-module domain rows — child tables first (FK). */
export async function cleanUsersData(prisma: PrismaService): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.emailVerificationCode.deleteMany();
  await prisma.passwordResetCode.deleteMany();
  await prisma.user.deleteMany();
}
