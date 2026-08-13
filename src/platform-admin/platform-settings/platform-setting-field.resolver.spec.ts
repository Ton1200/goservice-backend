import { PlatformSettingModel } from './models/platform-setting.model';
import { PlatformSettingFieldResolver } from './platform-setting-field.resolver';

const REAL_DECRYPTED_SECRET = 'this-is-the-real-decrypted-secret-9999';

/**
 * THE test proving §2's structural guardrail actually holds — see
 * `PlatformSettingFieldResolver`'s own header comment. This deliberately
 * constructs the WORST-CASE scenario the guardrail exists for: an
 * `isEncrypted: true` row whose `rawValue` was (hypothetically, due to a
 * future bug in whatever mapped it) populated with a REAL decrypted
 * secret, sitting right next to it in the same object — and proves the
 * resolver still never returns it, under `value` OR any other field name.
 */
describe('PlatformSettingFieldResolver (the value/maskedPreview leak guardrail)', () => {
  function makeEncryptedSettingWithLeakedRawValue(): PlatformSettingModel {
    const setting = new PlatformSettingModel();
    setting.id = 'setting-1';
    setting.key = 'customer.social-login.google.client-id';
    setting.description = 'Google client-id.';
    setting.valueType = 'STRING';
    setting.isEncrypted = true;
    setting.provider = 'GOOGLE';
    setting.updatedBy = 'Jane Admin';
    setting.createdAt = new Date('2026-01-01T00:00:00Z');
    setting.updatedAt = new Date('2026-01-02T00:00:00Z');
    // THE bug scenario this test exists for: a real decrypted secret,
    // present in the same object a future (hypothetically buggy) mapper
    // might have populated this from.
    setting.rawValue = REAL_DECRYPTED_SECRET;
    setting.rawMaskedPreview = '•••9999';
    return setting;
  }

  it('value() returns null for an isEncrypted:true row, even though rawValue holds a real decrypted secret', () => {
    const resolver = new PlatformSettingFieldResolver();
    const setting = makeEncryptedSettingWithLeakedRawValue();

    expect(resolver.value(setting)).toBeNull();
  });

  it('value() returns the raw value for an isEncrypted:false row', () => {
    const resolver = new PlatformSettingFieldResolver();
    const setting = makeEncryptedSettingWithLeakedRawValue();
    setting.isEncrypted = false;
    setting.rawValue = 'true';

    expect(resolver.value(setting)).toBe('true');
  });

  it('maskedPreview() returns null for an isEncrypted:false row', () => {
    const resolver = new PlatformSettingFieldResolver();
    const setting = makeEncryptedSettingWithLeakedRawValue();
    setting.isEncrypted = false;

    expect(resolver.maskedPreview(setting)).toBeNull();
  });

  it('maskedPreview() returns the masked preview for an isEncrypted:true row', () => {
    const resolver = new PlatformSettingFieldResolver();
    const setting = makeEncryptedSettingWithLeakedRawValue();

    expect(resolver.maskedPreview(setting)).toBe('•••9999');
  });

  it('the real decrypted secret never appears anywhere in the fully-resolved GraphQL object, under ANY field name', () => {
    const resolver = new PlatformSettingFieldResolver();
    const setting = makeEncryptedSettingWithLeakedRawValue();

    // Simulates what actually reaches the wire: every plain @Field() copied
    // as-is, PLUS the two guardrail-resolved fields via the resolver
    // methods (never `setting.rawValue`/`setting.rawMaskedPreview`
    // directly).
    const resolvedForWire = {
      id: setting.id,
      key: setting.key,
      description: setting.description,
      valueType: setting.valueType,
      isEncrypted: setting.isEncrypted,
      provider: setting.provider,
      updatedBy: setting.updatedBy,
      createdAt: setting.createdAt,
      updatedAt: setting.updatedAt,
      value: resolver.value(setting),
      maskedPreview: resolver.maskedPreview(setting),
    };

    expect(JSON.stringify(resolvedForWire)).not.toContain(
      REAL_DECRYPTED_SECRET,
    );
    expect(resolvedForWire.value).toBeNull();
  });
});
