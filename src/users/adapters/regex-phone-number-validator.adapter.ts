import { Injectable } from '@nestjs/common';
import { PhoneNumberValidatorPort } from '../ports/phone-number-validator.port';

// Simple placeholder validation, NOT libphonenumber-grade (that's TBD /
// not authorized for this story — see `phone-number-validator.port.ts`).
const COUNTRY_CODE_PATTERN = /^\+\d{1,3}$/;
const NUMBER_PATTERN = /^\d{6,14}$/;

@Injectable()
export class RegexPhoneNumberValidatorAdapter implements PhoneNumberValidatorPort {
  isValid(countryCode: string, number: string): boolean {
    return (
      COUNTRY_CODE_PATTERN.test(countryCode) && NUMBER_PATTERN.test(number)
    );
  }
}
