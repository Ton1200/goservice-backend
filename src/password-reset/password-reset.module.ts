import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { UsersModule } from '../users/users.module';
import { EmailQueuePasswordResetEmailSenderAdapter } from './adapters/email-queue-password-reset-email-sender.adapter';
import { PasswordResetEmailSenderPort } from './ports/password-reset-email-sender.port';
import { PasswordResetRepository } from './password-reset.repository';
import { PasswordResetResolver } from './password-reset.resolver';
import { IssuePasswordResetCodeService } from './services/issue-password-reset-code.service';
import { RequestPasswordResetService } from './services/request-password-reset.service';
import { ResetPasswordService } from './services/reset-password.service';

// `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
// need to be imported here explicitly — see `prisma.module.ts`.
//
// Imports `UsersModule` for `UsersRepository`/`PasswordHasherPort` (finding
// the user, hashing the new password), `EmailModule` for
// `EmailQueueService` (enqueuing the reset-code email), and `AuthModule`
// for `SessionPort.revokeAllSessionsForUser` (GOS-9's resolved
// session-revocation decision) plus the plain `isLoginEligibleStatus`
// function it also needs — see
// `goservice-backend/docs/gos9-plan-tecnico.md` §2/§11.
@Module({
  imports: [UsersModule, EmailModule, AuthModule],
  providers: [
    PasswordResetResolver,
    PasswordResetRepository,
    RequestPasswordResetService,
    ResetPasswordService,
    // Shared with the admin-triggered `forceUserAccountPasswordReset` — see
    // this service's own header comment for why it's ALSO registered
    // directly on `PlatformAdminModule` rather than this (resolver-bearing)
    // module being imported there.
    IssuePasswordResetCodeService,
    {
      provide: PasswordResetEmailSenderPort,
      useClass: EmailQueuePasswordResetEmailSenderAdapter,
    },
  ],
})
export class PasswordResetModule {}
