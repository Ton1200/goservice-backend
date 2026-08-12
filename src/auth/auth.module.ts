import { Module } from '@nestjs/common';
import { DateScalar } from '../common/graphql/date.scalar';
import { UsersModule } from '../users/users.module';
import { JoseSocialIdentityValidationAdapter } from './adapters/jose-social-identity-validation.adapter';
import { PostgresSessionAdapter } from './adapters/postgres-session.adapter';
import {
  buildDefaultSocialAuthProviderConfig,
  SOCIAL_AUTH_PROVIDER_CONFIG,
} from './config/social-auth-provider.config';
import { SessionPort } from './ports/session.port';
import { SocialIdentityValidationPort } from './ports/social-identity-validation.port';
import { LoginService } from './services/login.service';
import { LogoutService } from './services/logout.service';
import { SocialIdentityValidationService } from './services/social-identity-validation.service';
import { SocialLoginService } from './services/social-login.service';
import { SessionsRepository } from './sessions.repository';
import { SessionGuard } from './guards/session.guard';
import { AuthResolver } from './auth.resolver';
import { PlatformSettingsModule } from '../platform-admin/platform-settings/platform-settings.module';

// `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
// need to be imported here explicitly — see `prisma.module.ts`.
//
// Imports `UsersModule` for `UsersRepository`/`PasswordHasherPort` — both
// are `login`/`socialLogin`'s dependencies on the account/identity data
// owned by `users/`, exposed via `UsersModule`'s `exports` array rather
// than this module reaching into `users/` internals directly.
@Module({
  // `PlatformSettingsModule` (GOS-30/31/32, Slice 3 consolidation of the
  // former `FeatureFlagsModule`/`PlatformCredentialsModule`): exports ONLY
  // `PlatformSettingPort`/`CredentialEncryptionPort`/
  // `PlatformSettingsRepository` — a deliberately resolver-free module (see
  // its own header comment for why that's load-bearing, not incidental).
  // Confirmed via a dedicated Slice-1 spike that a module WITH a
  // `@Resolver()` class, imported transitively through a module listed in a
  // `GraphQLModule`'s `include` array, DOES leak that resolver's fields
  // into that schema — so the admin-only `PlatformSettingsResolver` must
  // never be reachable via this import.
  imports: [UsersModule, PlatformSettingsModule],
  providers: [
    AuthResolver,
    // Owns `Session` (GOS-7) — never exported outside this module, see
    // `sessions.repository.ts`'s header comment.
    SessionsRepository,
    // Registered here as its consumer for `LoginPayload.sessionExpiresAt`
    // — see `common/graphql/date.scalar.ts`. `RegisterInput.dateOfBirth`
    // (in `UsersModule`) is the scalar's other consumer; GraphQL code-first
    // scalar registration is effectively global once instantiated by ANY
    // module in the app, so it is intentionally registered in only one
    // place (here) rather than duplicated in both modules.
    DateScalar,
    SocialIdentityValidationService,
    SocialLoginService,
    LoginService,
    LogoutService,
    // Cross-cutting "must be logged in" guard for GraphQL resolvers — see
    // `guards/session.guard.ts`. Exported below so any future module that
    // wants to protect its own resolvers can `imports: [AuthModule]` and
    // use `@UseGuards(SessionGuard)` without redoing session validation.
    SessionGuard,
    {
      provide: SocialIdentityValidationPort,
      useClass: JoseSocialIdentityValidationAdapter,
    },
    { provide: SessionPort, useClass: PostgresSessionAdapter },
    {
      // Real Google/Apple jwksUri/issuer endpoints by default — see
      // `config/social-auth-provider.config.ts`. Tests override this
      // provider to point at a locally-served JWKS instead. No longer a
      // `ConfigService`-dependent factory (GOS-30/31/32 Slice 2): the
      // client-id/audience values this used to read from
      // `GOOGLE_CLIENT_ID`/`APPLE_CLIENT_ID` env vars now come from
      // `PlatformCredentialPort` instead, resolved per-request inside
      // `JoseSocialIdentityValidationAdapter`.
      provide: SOCIAL_AUTH_PROVIDER_CONFIG,
      useValue: buildDefaultSocialAuthProviderConfig(),
    },
  ],
  // `SessionPort` is exported for `PasswordResetModule` (`src/password-reset/`),
  // which needs `revokeAllSessionsForUser` for `resetPassword`'s
  // successful-completion step (GOS-9) — same reasoning as `UsersModule`
  // exporting `UsersRepository`/`PasswordHasherPort` above.
  exports: [SessionGuard, SessionPort],
})
export class AuthModule {}
