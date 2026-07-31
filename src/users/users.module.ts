import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import { DateScalar } from '../common/graphql/date.scalar';
import { Argon2PasswordHasherAdapter } from './adapters/argon2-password-hasher.adapter';
import { JoseSocialIdentityValidationAdapter } from './adapters/jose-social-identity-validation.adapter';
import { LoggingVerificationCodeSenderAdapter } from './adapters/logging-verification-code-sender.adapter';
import { RegexPhoneNumberValidatorAdapter } from './adapters/regex-phone-number-validator.adapter';
import {
  buildDefaultSocialAuthProviderConfig,
  SOCIAL_AUTH_PROVIDER_CONFIG,
} from './config/social-auth-provider.config';
import { PasswordHasherPort } from './ports/password-hasher.port';
import { PhoneNumberValidatorPort } from './ports/phone-number-validator.port';
import { SocialIdentityValidationPort } from './ports/social-identity-validation.port';
import { VerificationCodeSenderPort } from './ports/verification-code-sender.port';
import { RegisterUserService } from './services/register-user.service';
import { ResendVerificationCodeService } from './services/resend-verification-code.service';
import { SocialIdentityValidationService } from './services/social-identity-validation.service';
import { SocialLoginService } from './services/social-login.service';
import { VerifyEmailCodeService } from './services/verify-email-code.service';
import { UsersRepository } from './users.repository';
import { UsersResolver } from './users.resolver';

// `PrismaModule` (`src/prisma/`) is `@Global()`, so `PrismaService` doesn't
// need to be imported here explicitly — see `prisma.module.ts`.
@Module({
  providers: [
    UsersResolver,
    UsersRepository,
    // Registered here as its first/only consumer (`RegisterInput.dateOfBirth`)
    // — see `common/graphql/date.scalar.ts`. Would move to a shared module
    // if a second consumer appears.
    DateScalar,
    RegisterUserService,
    VerifyEmailCodeService,
    ResendVerificationCodeService,
    SocialIdentityValidationService,
    SocialLoginService,
    { provide: PasswordHasherPort, useClass: Argon2PasswordHasherAdapter },
    {
      provide: VerificationCodeSenderPort,
      useClass: LoggingVerificationCodeSenderAdapter,
    },
    {
      provide: PhoneNumberValidatorPort,
      useClass: RegexPhoneNumberValidatorAdapter,
    },
    {
      provide: SocialIdentityValidationPort,
      useClass: JoseSocialIdentityValidationAdapter,
    },
    {
      // Real Google/Apple endpoints by default — see
      // `config/social-auth-provider.config.ts`. Tests override this
      // provider to point at a locally-served JWKS instead.
      provide: SOCIAL_AUTH_PROVIDER_CONFIG,
      useFactory: (configService: ConfigService<AppConfig, true>) => {
        const { googleClientId, appleClientId } = configService.get(
          'socialAuth',
          { infer: true },
        );
        return buildDefaultSocialAuthProviderConfig(
          googleClientId,
          appleClientId,
        );
      },
      inject: [ConfigService],
    },
  ],
})
export class UsersModule {}
