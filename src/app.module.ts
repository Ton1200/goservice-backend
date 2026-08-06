import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { join } from 'path';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env-validation.schema';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';
import { GqlThrottlerGuard } from './common/guards/gql-throttler.guard';
import { PrismaModule } from './prisma/prisma.module';
import { SystemStatusModule } from './system-status/system-status.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { PasswordResetModule } from './password-reset/password-reset.module';
import { ProfilesModule } from './profiles/profiles.module';
import type { AppConfig } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
      validationSchema: envValidationSchema,
    }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // Code-first GraphQL authoring for this pilot: types/resolvers are
      // TypeScript classes/decorators, and the SDL below is generated from
      // them rather than hand-written. Chosen because it keeps a single
      // source of truth (TypeScript) for a small, infra-only pilot schema
      // and avoids a codegen step. This is a pilot-scoped choice, not the
      // ADR-level decision tracked as open in ADR 0002/graphql-contract.md
      // ("code-first vs schema-first") — a real ADR is still needed before
      // the first GoService domain module is built on GraphQL.
      autoSchemaFile: join(process.cwd(), 'src', 'schema.gql'),
      sortSchema: true,
      // GOS-8 acceptance criterion #11: error responses must never include
      // stack traces or internal details. Apollo defaults this to `true`
      // whenever NODE_ENV !== 'production', which would otherwise leak
      // internal file paths (e.g. on the generic REGISTRATION_FAILED
      // error) in local/dev/test runs, not just prod. Force it off
      // unconditionally instead of relying on NODE_ENV.
      includeStacktraceInErrorResponses: false,
      // Needed by `GqlThrottlerGuard` below: the default Apollo context
      // only exposes `req`, not `res` — throttler headers/blocking need
      // both.
      context: ({ req, res }: { req: unknown; res: unknown }) => ({
        req,
        res,
      }),
    }),
    // Redis-backed request-rate throttling (GOS-22) — see
    // `users.resolver.ts` for the per-mutation `@Throttle` limits and why
    // this is an ADDITIONAL layer, not the primary control for
    // verifyEmailCode/resendVerificationCode (that's DB-durable
    // attemptsCount/cooldown, enforced in their application services).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const redisConfig = configService.get('redis', { infer: true });
        return {
          throttlers: [{ ttl: 60_000, limit: 20 }],
          storage: new ThrottlerStorageRedisService(
            new Redis({
              host: redisConfig.host,
              port: redisConfig.port,
              password: redisConfig.password,
            }),
          ),
        };
      },
    }),
    // Dedicated Redis connection for BullMQ (email queue, GOS-22 follow-up
    // — see `EmailModule`). Deliberately NOT shared with
    // `ThrottlerStorageRedisService` above: BullMQ Workers require
    // `maxRetriesPerRequest: null` on their connection, and issue blocking
    // commands that shouldn't share a connection used for other purposes.
    // Same Redis *server* as the throttler (same REDIS_HOST/PORT/PASSWORD),
    // just a separate client.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const redisConfig = configService.get('redis', { infer: true });
        return {
          connection: {
            host: redisConfig.host,
            port: redisConfig.port,
            password: redisConfig.password,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    PrismaModule,
    SystemStatusModule,
    UsersModule,
    AuthModule,
    PasswordResetModule,
    ProfilesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
