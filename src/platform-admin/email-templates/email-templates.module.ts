import { Module } from '@nestjs/common';
import { EmailTemplatePort } from './ports/email-template.port';
import { EmailTemplatesRepository } from './email-templates.repository';
import { PrismaEmailTemplateAdapter } from './adapters/prisma-email-template.adapter';
import { EmailLayoutPort } from './ports/email-layout.port';
import { EmailLayoutRepository } from './email-layout.repository';
import { PrismaEmailLayoutAdapter } from './adapters/prisma-email-layout.adapter';

/**
 * Deliberately, load-bearingly RESOLVER-FREE — no `AdminEmailTemplatesResolver`,
 * no `@ObjectType()`/`@InputType()` wired here. Same defense as
 * `PlatformSettingsModule` (see that module's own header comment for the
 * confirmed transitive-leak risk this avoids): a module WITH a `@Resolver()`
 * class, imported transitively through a module listed in a
 * `GraphQLModule`'s `include` array, DOES leak that resolver's fields into
 * that schema.
 *
 * `AdminEmailTemplatesResolver`/`ListEmailTemplatesService`/
 * `UpdateEmailTemplateService`/`SendTestEmailTemplateService` are registered
 * directly on `PlatformAdminModule` instead — see that module's own header
 * comment.
 *
 * Imported by `EmailModule` (`src/email/email.module.ts`), which
 * re-exports it — that's the ONE place `EmailTemplatePort` becomes reachable
 * from, for every module that already imports `EmailModule` for
 * `EmailQueueService` (`UsersModule`, `PasswordResetModule`,
 * `PlatformAdminModule` for `admin-invites`). `EmailTemplatesRepository` is
 * ALSO exported (not just `EmailTemplatePort`) so `PlatformAdminModule` can
 * reuse the SAME repository instance for the admin-only read+write
 * resolver/services, rather than duplicating the Prisma wiring — mirrors
 * `PlatformSettingsModule` exporting `PlatformSettingsRepository` for the
 * exact same reason.
 *
 * Shared header/footer follow-up (2026-08-25): `EmailLayoutPort`/
 * `EmailLayoutRepository` are registered and exported here TOO, same
 * "resolver-free module, port + repository both reachable" shape as the
 * `EmailTemplate*` trio above — `EmailTemplateRenderer`
 * (`src/email/templates/email-template-renderer.service.ts`, a provider of
 * `EmailModule` itself, which already imports this module) depends on
 * `EmailLayoutPort` alongside `EmailTemplatePort`, and
 * `PlatformAdminModule`'s own `GetEmailLayoutService`/`UpdateEmailLayoutService`
 * reuse `EmailLayoutRepository` directly, mirroring
 * `EmailTemplatesRepository`'s own reuse.
 */
@Module({
  providers: [
    EmailTemplatesRepository,
    {
      provide: EmailTemplatePort,
      useClass: PrismaEmailTemplateAdapter,
    },
    EmailLayoutRepository,
    {
      provide: EmailLayoutPort,
      useClass: PrismaEmailLayoutAdapter,
    },
  ],
  exports: [
    EmailTemplatePort,
    EmailTemplatesRepository,
    EmailLayoutPort,
    EmailLayoutRepository,
  ],
})
export class EmailTemplatesModule {}
