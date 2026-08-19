import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { Argon2PasswordHasherAdapter } from './adapters/argon2-password-hasher.adapter';
import { EmailQueueVerificationCodeSenderAdapter } from './adapters/email-queue-verification-code-sender.adapter';
import { RegexPhoneNumberValidatorAdapter } from './adapters/regex-phone-number-validator.adapter';
import { PasswordHasherPort } from './ports/password-hasher.port';
import { PhoneNumberValidatorPort } from './ports/phone-number-validator.port';
import { VerificationCodeSenderPort } from './ports/verification-code-sender.port';
import { RegisterUserService } from './services/register-user.service';
import { ResendVerificationCodeService } from './services/resend-verification-code.service';
import { VerifyEmailCodeService } from './services/verify-email-code.service';
import { UsersRepository } from './users.repository';
import { UsersResolver } from './users.resolver';

// `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
// need to be imported here explicitly — see `prisma.module.ts`..
//
// `UsersRepository` and `PasswordHasherPort` are exported for `AuthModule`
// (`src/auth/`), which imports this module to reach `login`/`socialLogin`'s
// dependencies on account/identity data — see `auth.module.ts`.
@Module({
  imports: [EmailModule],
  providers: [
    UsersResolver,
    UsersRepository,
    RegisterUserService,
    VerifyEmailCodeService,
    ResendVerificationCodeService,
    { provide: PasswordHasherPort, useClass: Argon2PasswordHasherAdapter },
    {
      provide: VerificationCodeSenderPort,
      useClass: EmailQueueVerificationCodeSenderAdapter,
    },
    {
      provide: PhoneNumberValidatorPort,
      useClass: RegexPhoneNumberValidatorAdapter,
    },
  ],
  exports: [UsersRepository, PasswordHasherPort],
})
export class UsersModule {}
