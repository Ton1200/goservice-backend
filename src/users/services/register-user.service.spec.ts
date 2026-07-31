import { ConfigService } from '@nestjs/config';
import { DomainException } from '../../common/errors/domain-exception';
import { PasswordHasherPort } from '../ports/password-hasher.port';
import { PhoneNumberValidatorPort } from '../ports/phone-number-validator.port';
import { VerificationCodeSenderPort } from '../ports/verification-code-sender.port';
import { RegisterInput } from '../models/register-input.model';
import { UsersRepository } from '../users.repository';
import { RegisterUserService } from './register-user.service';

describe('RegisterUserService', () => {
  function makeService(overrides?: { existingUser?: unknown }) {
    const findByEmail = jest
      .fn()
      .mockResolvedValue(overrides?.existingUser ?? null);
    const createPasswordUser = jest.fn((data: Record<string, unknown>) => {
      void data; // referenced only so the mock's arg type is inferred
      return Promise.resolve({ id: 'user-1', email: 'jane@example.com' });
    });
    const createEmailVerificationCode = jest
      .fn()
      .mockResolvedValue({ id: 'code-1' });
    const usersRepository = {
      findByEmail,
      createPasswordUser,
      createEmailVerificationCode,
    } as unknown as UsersRepository;

    const hash = jest.fn().mockResolvedValue('hashed-password');
    const passwordHasher = { hash } as unknown as PasswordHasherPort;

    const isValid = jest.fn().mockReturnValue(true);
    const phoneNumberValidator = {
      isValid,
    } as unknown as PhoneNumberValidatorPort;

    const sendVerificationCode = jest.fn().mockResolvedValue(undefined);
    const verificationCodeSender = {
      sendVerificationCode,
    } as unknown as VerificationCodeSenderPort;

    const configService = {
      get: jest.fn().mockReturnValue({
        codeTtlMinutes: 15,
        resendCooldownSeconds: 60,
        maxAttempts: 5,
      }),
    } as unknown as ConfigService;

    const service = new RegisterUserService(
      usersRepository,
      passwordHasher,
      phoneNumberValidator,
      verificationCodeSender,
      configService as never,
    );

    return {
      service,
      findByEmail,
      createPasswordUser,
      isValid,
      sendVerificationCode,
    };
  }

  function validInput(overrides?: Partial<RegisterInput>): RegisterInput {
    return {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      password: 'super-secret-1',
      phoneCountryCode: '+54',
      phoneNumber: '91123456789',
      dateOfBirth: new Date('1990-05-21'),
      acceptedTermsAndPrivacy: true,
      ...overrides,
    };
  }

  it('registers successfully and returns emailVerificationRequired: true', async () => {
    const { service, createPasswordUser, sendVerificationCode } = makeService();

    const result = await service.register(validInput());

    expect(result).toEqual({
      userId: 'user-1',
      emailVerificationRequired: true,
    });
    expect(createPasswordUser).toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: 'hashed-password' }),
    );
    expect(sendVerificationCode).toHaveBeenCalledWith(
      'jane@example.com',
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it('throws generic REGISTRATION_FAILED when the email already exists (anti-enumeration)', async () => {
    const { service } = makeService({ existingUser: { id: 'existing' } });

    await expect(service.register(validInput())).rejects.toMatchObject({
      code: 'REGISTRATION_FAILED',
    });
  });

  it('throws INVALID_PHONE_NUMBER when the phone validator rejects the number', async () => {
    const { service, isValid } = makeService();
    isValid.mockReturnValue(false);

    await expect(service.register(validInput())).rejects.toMatchObject({
      code: 'INVALID_PHONE_NUMBER',
    });
  });

  it('throws INVALID_DATE_OF_BIRTH when the date of birth is in the future', async () => {
    const { service } = makeService();
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);

    await expect(
      service.register(validInput({ dateOfBirth: futureDate })),
    ).rejects.toMatchObject({ code: 'INVALID_DATE_OF_BIRTH' });
  });

  it('throws TERMS_NOT_ACCEPTED when acceptedTermsAndPrivacy is false', async () => {
    const { service } = makeService();

    await expect(
      service.register(validInput({ acceptedTermsAndPrivacy: false })),
    ).rejects.toMatchObject({ code: 'TERMS_NOT_ACCEPTED' });
  });

  it('never includes the plaintext password in the created-user payload', async () => {
    const { service, createPasswordUser } = makeService();

    await service.register(validInput());

    const createCallArg = createPasswordUser.mock.calls[0][0];
    expect(createCallArg.password).toBeUndefined();
    expect(createCallArg.passwordHash).toBe('hashed-password');
  });

  it('all thrown failures are DomainException instances', async () => {
    const { service } = makeService({ existingUser: { id: 'existing' } });
    await expect(service.register(validInput())).rejects.toBeInstanceOf(
      DomainException,
    );
  });
});
