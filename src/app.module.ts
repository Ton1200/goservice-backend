import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ServeStaticModule } from '@nestjs/serve-static';
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
import { IdentityVerificationModule } from './identity-verification/identity-verification.module';
import { PasswordResetModule } from './password-reset/password-reset.module';
import { ProfilesModule } from './profiles/profiles.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { PlatformPublicSettingsModule } from './platform-admin/platform-settings/public/platform-public-settings.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { EngagementsModule } from './engagements/engagements.module';
import { QuotesModule } from './quotes/quotes.module';
import { QuoteNegotiationModule } from './quote-negotiation/quote-negotiation.module';
import { ServiceRequestsModule } from './service-requests/service-requests.module';
import { EngagementChatModule } from './engagement-chat/engagement-chat.module';
import { AppointmentsModule } from './appointments/appointments.module';
import type { AppConfig } from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: '.env',
      validationSchema: envValidationSchema,
    }),
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      // `driver` must live HERE, at the top level of the `forRootAsync()`
      // options object — NOT inside `useFactory`'s returned config.
      // `GraphQLModule.forRootAsync()` reads `options.driver` synchronously
      // (`assertDriver`/`useClass: options.driver`) before the factory ever
      // runs; leaving it only inside the factory's return value throws
      // `Missing "driver" option` at Nest bootstrap (caught by running the
      // e2e suite after this change).
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        // Code-first GraphQL authoring for this pilot: types/resolvers are
        // TypeScript classes/decorators, and the SDL below is generated from
        // them rather than hand-written. Chosen because it keeps a single
        // source of truth (TypeScript) for a small, infra-only pilot schema
        // and avoids a codegen step. This is a pilot-scoped choice, not the
        // ADR-level decision tracked as open in ADR 0002/graphql-contract.md
        // ("code-first vs schema-first") — a real ADR is still needed before
        // the first GoService domain module is built on GraphQL.
        autoSchemaFile: join(process.cwd(), 'src', 'schema.gql'),
        // Load-bearing, not cosmetic (platform-admin plan §1): without an
        // explicit `include`, Nest's code-first schema builder scans the
        // WHOLE DI graph, which would leak `PlatformAdminModule`'s
        // resolvers/types into this public consumer schema. Every module
        // exposing a resolver on the public `/graphql` endpoint must be
        // listed here explicitly.
        include: [
          SystemStatusModule,
          UsersModule,
          AuthModule,
          PasswordResetModule,
          ProfilesModule,
          PlatformPublicSettingsModule,
          IdentityVerificationModule,
          ServiceRequestsModule,
          QuotesModule,
          QuoteNegotiationModule,
          EngagementsModule,
          DiscoveryModule,
          EngagementChatModule,
          AppointmentsModule,
        ],
        sortSchema: true,
        // GOS-8 acceptance criterion #11: error responses must never include
        // stack traces or internal details. Apollo defaults this to `true`
        // whenever NODE_ENV !== 'production', which would otherwise leak
        // internal file paths (e.g. on the generic REGISTRATION_FAILED
        // error) in local/dev/test runs, not just prod. Force it off
        // unconditionally instead of relying on NODE_ENV.
        includeStacktraceInErrorResponses: false,
        // Security-review fix: Apollo defaults introspection to "on
        // whenever NODE_ENV !== 'production'" — the same class of
        // NODE_ENV-linked framework default `includeStacktraceInErrorResponses`
        // above already refuses to trust. Read from config (default
        // `false` — see `configuration.ts`) instead, so introspection is
        // never accidentally on just because NODE_ENV is unset/non-prod.
        // Async factory (vs. a plain `forRoot()` object) specifically so
        // this reads live from `ConfigService` at DI-resolution time,
        // which also lets e2e tests override it per test app instance
        // (see `test/support/test-app.ts`).
        introspection: configService.get('graphqlIntrospectionEnabled', {
          infer: true,
        }),
        // Needed by `GqlThrottlerGuard` below: the default Apollo context
        // only exposes `req`, not `res` — throttler headers/blocking need
        // both.
        context: ({ req, res }: { req: unknown; res: unknown }) => ({
          req,
          res,
        }),
      }),
    }),
    // Second, isolated GraphQL endpoint (`/admin/graphql`) for the
    // platform-admin capability (GOS-30/31/32) — see
    // `src/platform-admin/platform-admin.module.ts` and the plan's "Second
    // GraphQL endpoint — how it's wired" section. `include` here is what
    // keeps this schema scoped to ONLY `PlatformAdminModule`'s
    // resolvers/types, isolated from the public schema above (verified by
    // the Slice-1 spike — see the schema-isolation e2e smoke test).
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      // See the public `/graphql` registration above for why `driver` must
      // be at this top level, not inside `useFactory`'s return value.
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        // Derived from the single `adminPanelPath` config value (see its
        // doc comment in `config/configuration.ts`), NOT a separately
        // settable env var — deliberate, so this can never drift out of
        // sync with the `ServeStaticModule` registration's `serveRoot`/
        // `exclude` below, the exact class of bug ADR 0005 already
        // documents once for this pairing.
        path: `${configService.get('adminPanelPath', { infer: true })}/graphql`,
        autoSchemaFile: join(process.cwd(), 'src', 'admin-schema.gql'),
        include: [PlatformAdminModule],
        sortSchema: true,
        includeStacktraceInErrorResponses: false,
        // Same fix/rationale as the public `/graphql` registration above —
        // arguably even higher-stakes here since this schema also
        // describes admin-only mutations/fields.
        introspection: configService.get('graphqlIntrospectionEnabled', {
          infer: true,
        }),
        context: ({ req, res }: { req: unknown; res: unknown }) => ({
          req,
          res,
        }),
      }),
    }),
    // Serves `admin-panel/` (plain HTML/CSS/vanilla JS, no build tool) at
    // `${adminPanelPath}` (default `/admin`, configurable — see
    // `config/configuration.ts`'s `adminPanelPath` doc comment) — see
    // `goservice-backend/admin-panel/` and the plan's "Admin panel UI"
    // section. `exclude` is load-bearing: without it, static serving would
    // shadow the `${adminPanelPath}/graphql` route registered just above.
    // `forRootAsync()` (not `forRoot()`) specifically so `serveRoot`/
    // `exclude` can be computed from `ConfigService` at DI-resolution time,
    // from the SAME `adminPanelPath` value the GraphQL registration above
    // reads — see that registration's comment for why a single source
    // value (not two independently-settable env vars) is deliberate.
    ServeStaticModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const adminPanelPath = configService.get('adminPanelPath', {
          infer: true,
        });
        return [
          {
            // `process.cwd()`, not `__dirname` — same reasoning as
            // `autoSchemaFile: join(process.cwd(), 'src', 'schema.gql')`
            // above. `__dirname` breaks: at runtime the compiled module
            // lives at `dist/src/app.module.js`, one directory level
            // deeper than `admin-panel/` (which sits at the repo root,
            // never compiled), while under ts-jest/`nest start --watch` it
            // resolves from `src/` instead — two different, incompatible
            // depths. `process.cwd()` is stable across
            // `start`/`start:dev`/`start:prod`/Jest e2e, all of which are
            // invoked from the backend package root. Confirmed via the
            // Slice-1 spike (a `__dirname`-based path 404'd under `npm run
            // start`).
            rootPath: join(process.cwd(), 'admin-panel'),
            serveRoot: adminPanelPath,
            // `path-to-regexp@8` (pulled in via Express 5) requires a
            // NAMED wildcard segment (`*splat`), not the bare `*` the
            // plan's original draft used — a bare `${adminPanelPath}/graphql*`
            // throws `PathError: Missing parameter name` at startup on
            // every request under `${adminPanelPath}/*`. Confirmed via the
            // Slice-1 spike; documented as a deviation in the final
            // report/ADR.
            exclude: [
              `${adminPanelPath}/graphql`,
              `${adminPanelPath}/graphql/*splat`,
            ],
          },
        ];
      },
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
    PlatformAdminModule,
    PlatformPublicSettingsModule,
    IdentityVerificationModule,
    ServiceRequestsModule,
    QuotesModule,
    QuoteNegotiationModule,
    EngagementsModule,
    DiscoveryModule,
    EngagementChatModule,
    AppointmentsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
  ],
})
export class AppModule {}
