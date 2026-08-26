import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { DomainException } from '../../common/errors/domain-exception';
import { EnsureEmailDeliveryAvailableService } from '../../email/services/ensure-email-delivery-available.service';
import { PasswordHasherPort } from '../ports/password-hasher.port';
import { PhoneNumberValidatorPort } from '../ports/phone-number-validator.port';
import { VerificationCodeSenderPort } from '../ports/verification-code-sender.port';
import { RegisterInput } from '../models/register-input.model';
import { RegisterPayload } from '../models/register-payload.model';
import { UsersRepository } from '../users.repository';
import { generateVerificationCode } from './verification-code.util';

/**
 * Orchestrates email+password registration (GOS-22). All business-rule
 * validation for `register` lives here, never in the resolver or the ORM
 * entity — see goservice-docs/architecture/backend.md.
 *
 * Note on error shape: `RegisterPayload` has no `errors` field, so every
 * failure here is a thrown `DomainException`. Only "email already exists"
 * uses the generic, anti-enumeration `REGISTRATION_FAILED` code — the
 * other validation failures use specific codes since they carry no
 * account-enumeration risk (see the GOS-22 plan's "Decisiones y
 * discrepancias" #4).
 */
@Injectable()
export class RegisterUserService {
  private readonly logger = new Logger(RegisterUserService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly passwordHasher: PasswordHasherPort,
    private readonly phoneNumberValidator: PhoneNumberValidatorPort,
    private readonly verificationCodeSender: VerificationCodeSenderPort,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly ensureEmailDeliveryAvailable: EnsureEmailDeliveryAvailableService,
  ) {}

  async register(input: RegisterInput): Promise<RegisterPayload> {
    // Checked FIRST, before any other work — mirrors
    // `SocialLoginService.socialLogin`'s exact ordering precedent for its
    // own upfront feature-flag check. `register` cannot complete without
    // sending a real verification-code email, so an unavailable email
    // provider must fail loudly here rather than create an account the
    // user can never verify.
    await this.ensureEmailDeliveryAvailable.ensureAvailable();

    const existingUser = await this.usersRepository.findByEmail(input.email);
    if (existingUser) {
      // Never reveal whether the collision is a password or social
      // account — anti-enumeration.
      this.logAttempt('failure', 'email_already_registered');
      throw new DomainException('REGISTRATION_FAILED', 'Registration failed.');
    }

    if (
      !this.phoneNumberValidator.isValid(
        input.phoneCountryCode,
        input.phoneNumber,
      )
    ) {
      this.logAttempt('failure', 'invalid_phone_number');
      throw new DomainException(
        'INVALID_PHONE_NUMBER',
        'The provided phone number is not valid.',
      );
    }

    if (this.isInTheFuture(input.dateOfBirth)) {
      this.logAttempt('failure', 'invalid_date_of_birth');
      throw new DomainException(
        'INVALID_DATE_OF_BIRTH',
        'Date of birth must be a real calendar date that is not in the future.',
      );
    }
    // No minimum-age policy is enforced here — explicitly TBD business
    // rule, not invented (see goservice-docs/product/business-rules.md).

    if (input.acceptedTermsAndPrivacy !== true) {
      this.logAttempt('failure', 'terms_not_accepted');
      throw new DomainException(
        'TERMS_NOT_ACCEPTED',
        'Terms and privacy policy must be accepted to register.',
      );
    }

    // Never log the plaintext password, before or after hashing.
    const passwordHash = await this.passwordHasher.hash(input.password);

    const user = await this.usersRepository.createPasswordUser({
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      passwordHash,
      phoneCountryCode: input.phoneCountryCode,
      phoneNumber: input.phoneNumber,
      dateOfBirth: input.dateOfBirth,
      acceptedTermsAndPrivacy: input.acceptedTermsAndPrivacy,
    });

    await this.issueAndSendVerificationCode(
      user.id,
      user.email,
      user.firstName,
    );

    this.logAttempt('success');
    return { userId: user.id, emailVerificationRequired: true };
  }

  private async issueAndSendVerificationCode(
    userId: string,
    email: string,
    firstName: string | null,
  ): Promise<void> {
    const { codeTtlMinutes } = this.configService.get('emailVerification', {
      infer: true,
    });
    const { code, codeHash } = generateVerificationCode();
    const expiresAt = new Date(Date.now() + codeTtlMinutes * 60_000);

    await this.usersRepository.createEmailVerificationCode({
      userId,
      codeHash,
      expiresAt,
    });

    // Never logs the plaintext code or raw email itself.
    await this.verificationCodeSender.sendVerificationCode(
      email,
      code,
      firstName,
    );
  }

  private isInTheFuture(date: Date): boolean {
    return date.getTime() > Date.now();
  }

  private logAttempt(
    outcome: 'success' | 'failure',
    failureReason?: string,
  ): void {
    this.logger.log({
      event: 'register_attempt',
      outcome,
      ...(failureReason ? { failureReason } : {}),
    });
  }
}
