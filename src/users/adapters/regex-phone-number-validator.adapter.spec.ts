import { RegexPhoneNumberValidatorAdapter } from './regex-phone-number-validator.adapter';

describe('RegexPhoneNumberValidatorAdapter', () => {
  const adapter = new RegexPhoneNumberValidatorAdapter();

  it.each([
    ['+54', '91123456789'],
    ['+1', '2025551234'],
    ['+999', '123456'],
  ])('accepts a valid countryCode=%s number=%s', (countryCode, number) => {
    expect(adapter.isValid(countryCode, number)).toBe(true);
  });

  it.each([
    ['54', '91123456789'], // missing leading +
    ['+9999', '123456'], // country code too long
    ['+54', '12345'], // number too short
    ['+54', '123456789012345'], // number too long
    ['+54', 'abc12345'], // non-numeric
    ['', ''],
  ])('rejects an invalid countryCode=%s number=%s', (countryCode, number) => {
    expect(adapter.isValid(countryCode, number)).toBe(false);
  });
});
