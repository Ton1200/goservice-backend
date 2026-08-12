import { Module } from '@nestjs/common';
import { PasswordHasherPort } from '../users/ports/password-hasher.port';
import { Argon2PasswordHasherAdapter } from '../users/adapters/argon2-password-hasher.adapter';
import { UsersRepository } from '../users/users.repository';
import { EmailModule } from '../email/email.module';
import { PasswordResetRepository } from '../password-reset/password-reset.repository';
import { PasswordResetEmailSenderPort } from '../password-reset/ports/password-reset-email-sender.port';
import { EmailQueuePasswordResetEmailSenderAdapter } from '../password-reset/adapters/email-queue-password-reset-email-sender.adapter';
import { IssuePasswordResetCodeService } from '../password-reset/services/issue-password-reset-code.service';
import './admin-rbac/admin-permission.enum'; // GraphQL enum registration side effect
import './user-accounts/models/user-account-status.enum'; // GraphQL enum registration side effect
import './user-accounts/models/auth-provider.enum'; // GraphQL enum registration side effect
import { AdminRolesRepository } from './admin-rbac/admin-roles.repository';
import { AdminRbacService } from './admin-rbac/services/admin-rbac.service';
import { AdminPermissionsGuard } from './admin-rbac/guards/admin-permissions.guard';
import { AdminUsersRepository } from './admin-auth/admin-users.repository';
import { AdminSessionsRepository } from './admin-auth/admin-sessions.repository';
import { AdminSessionPort } from './admin-auth/ports/admin-session.port';
import { PostgresAdminSessionAdapter } from './admin-auth/adapters/postgres-admin-session.adapter';
import { AdminSessionGuard } from './admin-auth/guards/admin-session.guard';
import { AdminLoginService } from './admin-auth/services/admin-login.service';
import { AdminLogoutService } from './admin-auth/services/admin-logout.service';
import { AdminAuthResolver } from './admin-auth/admin-auth.resolver';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module';
import { PlatformSettingsResolver } from './platform-settings/platform-settings.resolver';
import { PlatformSettingFieldResolver } from './platform-settings/platform-setting-field.resolver';
import { ListPlatformSettingsService } from './platform-settings/services/list-platform-settings.service';
import { SetPlatformSettingService } from './platform-settings/services/set-platform-setting.service';
import { AuditLogRepository } from './audit-log/audit-log.repository';
import { UserAccountsResolver } from './user-accounts/user-accounts.resolver';
import { ListUserAccountsService } from './user-accounts/services/list-user-accounts.service';
import { UpdateUserAccountService } from './user-accounts/services/update-user-account.service';
import { ForceUserAccountPasswordResetService } from './user-accounts/services/force-user-account-password-reset.service';
import { DeleteUserAccountService } from './user-accounts/services/delete-user-account.service';
import { BulkDeleteUserAccountsService } from './user-accounts/services/bulk-delete-user-accounts.service';
import { GetUserAccountDetailService } from './user-accounts/services/get-user-account-detail.service';

/**
 * Root module for the isolated `/admin/graphql` endpoint (see
 * `src/app.module.ts`'s second `GraphQLModule.forRoot({ include:
 * [PlatformAdminModule], ... })`). Everything reachable from this module's
 * DI graph is fair game for that schema — the inverse of `AuthModule`'s
 * `PlatformSettingsModule` import, which is deliberately scoped to a
 * resolver-free module for exactly the opposite reason (see
 * `platform-settings/platform-settings.module.ts`'s header comment for the
 * confirmed leak risk this avoids).
 *
 * `PlatformSettingsResolver`/`PlatformSettingFieldResolver`/
 * `SetPlatformSettingService`/`ListPlatformSettingsService` (Slice 3 —
 * replaces the former `FeatureFlagsResolver`/`SetFeatureFlagService` and
 * `PlatformCredentialsResolver`/`SetPlatformCredentialService`/
 * `ListPlatformCredentialsService`) are registered HERE directly (not
 * inside `PlatformSettingsModule`) so they are reachable ONLY from the
 * admin schema, never from the public one via `AuthModule`'s import of
 * `PlatformSettingsModule` (for `PlatformSettingPort` alone).
 *
 * CONFIRMED DEVIATION from the plan's literal wording ("import UsersModule"
 * for `PasswordHasherPort`/`Argon2PasswordHasherAdapter`): a second Slice-1
 * spike found that importing the FULL `UsersModule` here leaked
 * `UsersResolver`'s `register`/`verifyEmailCode`/`resendVerificationCode`
 * mutations into the ADMIN schema (the exact same transitive-import leak
 * risk as `FeatureFlagsModule`'s own header comment, just in the opposite
 * direction — `UsersModule` contains a real `@Resolver()`). Fix: reuse the
 * `Argon2PasswordHasherAdapter` CLASS directly (still zero duplicated
 * hashing logic/argon2 wiring — the actual concern the plan's deviation #1
 * was protecting against) via a second `{ provide: PasswordHasherPort, ...
 * }` registration, WITHOUT importing `UsersModule` itself. Flagged for
 * reviewer sign-off alongside the plan's own deviation #1.
 *
 * `user-accounts/` (GOS-3x follow-up, 2026-08-10 — `userAccounts`/
 * `updateUserAccount`/`forceUserAccountPasswordReset`) is the SAME
 * "reuse the concrete provider class directly, never import the
 * resolver-bearing module" pattern applied TWICE more, for two more
 * resolver-bearing modules this feature would otherwise need:
 *   - `UsersRepository` (owned by `UsersModule`) is reused directly — it's
 *     the ONLY class in this codebase allowed to issue Prisma queries for
 *     `User` (see its own header comment), so this admin capability goes
 *     through it too, rather than a second, competing repository querying
 *     `user` directly. `UsersModule` itself is never imported here (same
 *     `UsersResolver` leak risk as documented above).
 *   - `IssuePasswordResetCodeService`/`PasswordResetRepository`/
 *     `PasswordResetEmailSenderPort` (owned by `PasswordResetModule`) are
 *     reused directly for `forceUserAccountPasswordReset` — `PasswordResetModule`
 *     itself is never imported here (it has its own `PasswordResetResolver`,
 *     the same leak class again). See `IssuePasswordResetCodeService`'s own
 *     header comment.
 *   - `EmailModule` IS imported directly below (unlike the case above) — it
 *     is deliberately resolver-free (see its own header comment, mirroring
 *     `PlatformSettingsModule`'s own resolver-free design), so importing it
 *     carries no leak risk; needed here for
 *     `EnsureEmailDeliveryAvailableService` (the force-reset gate) and
 *     `EmailQueueService` (a transitive dependency of
 *     `EmailQueuePasswordResetEmailSenderAdapter`).
 *
 * `deleteUserAccount`/`bulkDeleteUserAccounts` (GOS-3x follow-up,
 * hard-delete, 2026-08-11 — REPLACES the prior round's reversible
 * `deactivateUserAccount`/`reactivateUserAccount`/`bulkDeactivateUserAccounts`
 * soft-delete entirely) rely on Postgres's own `onDelete: Cascade` on every
 * child table (`Session`/`EmailVerificationCode`/`PasswordResetCode`/
 * `CustomerProfile`/`ProfessionalProfile`) — no application-level session
 * revocation is needed anymore, so `SessionsRepository` (previously reused
 * here a third time for that purpose) is no longer imported by this module
 * at all.
 *
 * `JsonScalar` is deliberately NOT registered here (re-investigated
 * 2026-08-09, same day, later pass, when `platformConfig` was reshaped a
 * second time from `[PlatformConfigGroup!]!` — one entry per feature, each
 * an `@ObjectType()` with a `fields: JSON!` map — to a single bare `JSON!`
 * scalar for the whole response, and `PlatformConfigGroup` was deleted
 * entirely). It WAS required here, transiently, for exactly one reason:
 * `@nestjs/graphql`'s code-first schema builder keeps its
 * `OrphanedReferenceRegistry`/`TypeDefinitionsStorage` as PROCESS-WIDE
 * singletons, not scoped per `GraphQLModule.forRootAsync()` registration —
 * `PlatformConfigGroup`, an `@ObjectType()` reachable only from the PUBLIC
 * schema's `platformConfig` query, was auto-added as an "orphaned type"
 * into EVERY schema this process builds, including this admin one, and
 * once that orphaned type gained a `JSON`-typed field, the ADMIN schema
 * failed to build AT ALL (a hard crash, not a silent leak) without `JSON`
 * also being resolvable here. With `PlatformConfigGroup` gone, there is no
 * longer any orphaned `@ObjectType()` pulling `JSON` in transitively, and a
 * bare scalar return type on a resolver in a module never imported into
 * this schema's `include` array does not, on its own, get force-included
 * the way an `@ObjectType()` did. Verified empirically, not assumed: removed
 * this registration and confirmed via `npm run build` and the full
 * `admin-schema-isolation.e2e-spec.ts` suite that the admin schema still
 * builds and boots correctly with no `JsonScalar` provider anywhere in this
 * module's DI graph. If a genuine `JSON`-typed field is ever added directly
 * to the admin schema in the future, re-add `JsonScalar` to this module's
 * `providers` at that point — don't assume it stays working automatically
 * for a NEW orphaned/reachable `@ObjectType()` without reverifying the same
 * way.
 *
 * ANOTHER CONFIRMED INSTANCE of the SAME `OrphanedReferenceRegistry`
 * behavior (GOS-3x follow-up, 2026-08-10): once `UserAccountModel`/
 * `UserAccountsPageModel`/`UpdateUserAccountInput`/
 * `ForceUserAccountPasswordResetPayload` (admin-only, reachable only from
 * `UserAccountsResolver`) existed, their type DEFINITIONS started appearing
 * in the PUBLIC schema's `__schema.types` too (confirmed live) — the same
 * "every `@ObjectType()`/`@InputType()`/registered enum ever decorated in
 * this process is a candidate orphaned type for EVERY schema build"
 * mechanism as `PlatformConfigGroup` above, just the OPPOSITE direction
 * (admin → public, rather than public → admin) and NOT a build crash this
 * time (no `JSON`-typed field involved) — just a type definition
 * co-existing, unreachable, in the public SDL. Per
 * `admin-schema-isolation.e2e-spec.ts`'s own already-documented scope (see
 * that file's header comment), this is a KNOWN, ACCEPTED class of
 * @nestjs/graphql code-first artifact — the actual, tested isolation
 * property this codebase defends is "no admin-only FIELD is ever
 * REACHABLE from the public schema's Query/Mutation" (and vice versa), not
 * "no admin-only type definition ever appears anywhere in `__schema.types`"
 * — the pre-existing converse case (`CustomerProfile`/`RegisterPayload`/
 * etc. already appearing in `admin-schema.gql`'s own SDL, unreachable from
 * any admin operation) already established this exact precedent before this
 * change. Verified via the isolation suite's own new, explicit check that
 * these 4 types are never the REACHABLE return/arg type of any public
 * query/mutation field.
 *
 * `userAccountDetail` (GOS-3x follow-up, "View" row action, 2026-08-11)
 * REUSES `CustomerProfile`/`ProfessionalProfile`/`ProfessionalSpecialization`/
 * `Category` (`src/profiles/models/`) directly as `UserAccountDetailModel`'s
 * field types, WITHOUT importing `ProfilesModule` (it owns its own
 * `ProfilesResolver` — the exact same leak class documented above; only the
 * TYPE definitions are needed here, never `ProfilesRepository`/its
 * services). This is the CustomerProfile/ProfessionalProfile-shaped
 * instance of the SAME `OrphanedReferenceRegistry` mechanism described
 * above: those 4 classes' type definitions were already present,
 * unreachable, in `admin-schema.gql`'s SDL before this field existed (the
 * "pre-existing converse case" the comment above already calls out); this
 * field is what makes them REACHABLE from an admin operation for the first
 * time. Confirmed this does NOT introduce a new schema-isolation violation:
 * zero admin-only query/mutation FIELD becomes reachable from `/graphql`,
 * and zero consumer-only query/mutation FIELD becomes reachable from
 * `/admin/graphql` — `admin-schema-isolation.e2e-spec.ts`'s actual tested
 * property (field reachability, not "which type definitions co-exist in
 * `__schema.types`") is unaffected.
 */
@Module({
  imports: [PlatformSettingsModule, EmailModule],
  providers: [
    // admin-rbac
    AdminRolesRepository,
    AdminRbacService,
    AdminPermissionsGuard,

    // admin-auth
    AdminUsersRepository,
    AdminSessionsRepository,
    AdminSessionGuard,
    AdminLoginService,
    AdminLogoutService,
    AdminAuthResolver,
    { provide: AdminSessionPort, useClass: PostgresAdminSessionAdapter },
    { provide: PasswordHasherPort, useClass: Argon2PasswordHasherAdapter },

    // platform-settings (Slice 3 — resolver/field-resolver/read+write-service
    // only; the port/repository/encryption adapter come from the imported
    // `PlatformSettingsModule`)
    PlatformSettingsResolver,
    PlatformSettingFieldResolver,
    ListPlatformSettingsService,
    SetPlatformSettingService,

    // audit-log (write path only — Slice 1)
    AuditLogRepository,

    // user-accounts (GOS-3x follow-up, 2026-08-10) — resolver/services
    // owned here; `UsersRepository` and the password-reset-code-issuance
    // trio are reused CONCRETE CLASSES from `UsersModule`/
    // `PasswordResetModule` (see this module's own header comment for why
    // those two modules are never imported wholesale).
    UsersRepository,
    PasswordResetRepository,
    {
      provide: PasswordResetEmailSenderPort,
      useClass: EmailQueuePasswordResetEmailSenderAdapter,
    },
    IssuePasswordResetCodeService,
    UserAccountsResolver,
    ListUserAccountsService,
    UpdateUserAccountService,
    ForceUserAccountPasswordResetService,
    // GOS-3x follow-up (hard-delete, 2026-08-11) — REPLACES the prior
    // round's DeactivateUserAccountService/ReactivateUserAccountService/
    // BulkDeactivateUserAccountsService (and their SessionsRepository
    // dependency, no longer needed — see this module's own header comment).
    DeleteUserAccountService,
    BulkDeleteUserAccountsService,
    // userAccountDetail (GOS-3x follow-up, "View" row action) — reuses
    // UsersRepository directly (already a provider above), same
    // "concrete class, never the resolver-bearing module" pattern; its
    // customerProfile/professionalProfile fields reuse the CustomerProfile/
    // ProfessionalProfile GraphQL classes from ProfilesModule WITHOUT
    // importing that module (it has its own ProfilesResolver — the same
    // leak class documented above), since only the TYPE, never a service
    // from it, is needed here.
    GetUserAccountDetailService,
  ],
})
export class PlatformAdminModule {}
