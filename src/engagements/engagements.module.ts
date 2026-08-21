import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IdentityVerificationModule } from '../identity-verification/identity-verification.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { UsersModule } from '../users/users.module';
import { EngagementsRepository } from './engagements.repository';
import { EngagementsResolver } from './engagements.resolver';
import { ListMyEngagementsAsCustomerService } from './services/list-my-engagements-as-customer.service';
import { ListMyEngagementsAsProfessionalService } from './services/list-my-engagements-as-professional.service';

/**
 * `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
 * need to be imported here explicitly.
 *
 * Imports: `AuthModule` for `SessionGuard`; `IdentityVerificationModule`
 * for `AccountApprovedGuard`; `UsersModule` directly too (same reasoning as
 * `ServiceRequestsModule`'s own header comment: `AccountApprovedGuard`
 * needs `UsersRepository` resolvable from THIS module's injector, not only
 * `IdentityVerificationModule`'s own); `ProfilesModule` for
 * `ProfilesRepository`.
 *
 * Deliberately does NOT import `ServiceRequestsModule` or `QuotesModule` —
 * this module is a lean, leaf "repository + GraphQL type + read queries"
 * module, reused by BOTH `quotes/` (`AcceptQuoteService`, via
 * `EngagementsRepository` exported below) and `service-requests/`
 * (`ServiceRequestFieldResolver`, same export) without either of them
 * pulling in this module's own resolver as a side effect — same "reuse the
 * concrete repository class directly, never import the resolver-bearing
 * Module" pattern already established elsewhere in this codebase (see
 * `service-requests.module.ts`'s own comment). This also gives a future
 * Chat/Notifications module (see goservice-docs/product/roadmap.md) a
 * clean import point without dragging in all of `quotes/`.
 */
@Module({
  imports: [
    AuthModule,
    IdentityVerificationModule,
    ProfilesModule,
    UsersModule,
  ],
  providers: [
    EngagementsResolver,
    EngagementsRepository,
    ListMyEngagementsAsCustomerService,
    ListMyEngagementsAsProfessionalService,
  ],
  exports: [EngagementsRepository],
})
export class EngagementsModule {}
