import { createHmac } from 'node:crypto';
import {
  signRapydRequest,
  verifyRapydWebhookSignature,
} from './rapyd-signature.util';

// Synthetic values only — no real key. The expected signatures below are
// computed here with `node:crypto` straight from the FORMULAS in Rapyd's docs
// (request-signatures.html / webhook-authentication.html), independently of
// the util under test, so a slip in the util's string layout or encoding
// cannot hide behind its own output.
const ACCESS_KEY = 'rak_test_access_key';
const SECRET_KEY = 'rsk_test_secret_key';

function hexThenBase64(secret: string, toSign: string): string {
  const hex = createHmac('sha256', secret).update(toSign).digest('hex');
  return Buffer.from(hex).toString('base64');
}

describe('signRapydRequest', () => {
  it('signs method(lowercase) + urlPath + salt + timestamp + accessKey + secretKey + body, as BASE64(HEX(HMAC-SHA256))', () => {
    const body = JSON.stringify({ amount: 50000, currency: 'ARS' });

    const result = signRapydRequest({
      method: 'POST',
      urlPath: '/v1/checkout',
      body,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      salt: 'abcdef0123456789',
      timestamp: '1789585032',
    });

    expect(result.salt).toBe('abcdef0123456789');
    expect(result.timestamp).toBe('1789585032');
    expect(result.signature).toBe(
      hexThenBase64(
        SECRET_KEY,
        `post/v1/checkoutabcdef01234567891789585032${ACCESS_KEY}${SECRET_KEY}${body}`,
      ),
    );
  });

  it('is the base64 of the HEX digest — NOT of the raw digest bytes (the double encoding Rapyd requires)', () => {
    const toSign = `get/v1/checkout/checkout_1s1t1${ACCESS_KEY}${SECRET_KEY}`;
    const rawDigestBase64 = createHmac('sha256', SECRET_KEY)
      .update(toSign)
      .digest('base64');

    const { signature } = signRapydRequest({
      method: 'GET',
      urlPath: '/v1/checkout/checkout_1',
      body: '',
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      salt: 's1',
      timestamp: 't1',
    });

    expect(signature).not.toBe(rawDigestBase64);
    expect(signature).toBe(hexThenBase64(SECRET_KEY, toSign));
  });

  it('includes the query string of the path in the signed string', () => {
    const withQuery = signRapydRequest({
      method: 'GET',
      urlPath: '/v1/payments?limit=1',
      body: '',
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      salt: 's',
      timestamp: '1',
    });
    const withoutQuery = signRapydRequest({
      method: 'GET',
      urlPath: '/v1/payments',
      body: '',
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      salt: 's',
      timestamp: '1',
    });

    expect(withQuery.signature).not.toBe(withoutQuery.signature);
  });

  it('generates a fresh random salt (16 hex chars) and a current unix-seconds timestamp when none is injected', () => {
    const before = Math.floor(Date.now() / 1000);

    const a = signRapydRequest({
      method: 'GET',
      urlPath: '/v1/x',
      body: '',
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
    });
    const b = signRapydRequest({
      method: 'GET',
      urlPath: '/v1/x',
      body: '',
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
    });

    expect(a.salt).toMatch(/^[0-9a-f]{16}$/);
    expect(a.salt).not.toBe(b.salt);
    expect(Number(a.timestamp)).toBeGreaterThanOrEqual(before);
    expect(Number(a.timestamp)).toBeLessThanOrEqual(before + 5);
  });
});

describe('verifyRapydWebhookSignature', () => {
  const URL = 'https://api.goservice.example/webhooks/rapyd/ar';
  const SALT = 'webhooksalt01';
  const TIMESTAMP = '1789585100';
  const RAW_BODY = JSON.stringify({
    id: 'wh_1',
    type: 'PAYMENT_COMPLETED',
    data: { id: 'payment_abc', merchant_reference_id: 'e-1' },
  });

  function toSign(url = URL, body = RAW_BODY): string {
    // url_path + salt + timestamp + access_key + secret_key + body_string —
    // NO http method (unlike a request signature).
    return url + SALT + TIMESTAMP + ACCESS_KEY + SECRET_KEY + body;
  }

  function verify(overrides?: {
    signature?: string;
    salt?: string | undefined;
    timestamp?: string | undefined;
    rawBody?: string;
    webhookUrl?: string;
    secretKey?: string;
  }) {
    return verifyRapydWebhookSignature({
      signature:
        overrides && 'signature' in overrides
          ? overrides.signature
          : hexThenBase64(SECRET_KEY, toSign()),
      salt: overrides && 'salt' in overrides ? overrides.salt : SALT,
      timestamp:
        overrides && 'timestamp' in overrides ? overrides.timestamp : TIMESTAMP,
      webhookUrl: overrides?.webhookUrl ?? URL,
      rawBody: overrides?.rawBody ?? RAW_BODY,
      accessKey: ACCESS_KEY,
      secretKey: overrides?.secretKey ?? SECRET_KEY,
    });
  }

  it('accepts a signature built with the documented webhook formula (base64 of the hex digest)', () => {
    expect(verify()).toBe(true);
  });

  it("also accepts the base64 of the RAW digest — the docs don't say which, and both need the secret", () => {
    const raw = createHmac('sha256', SECRET_KEY)
      .update(toSign())
      .digest('base64');

    expect(verify({ signature: raw })).toBe(true);
  });

  it('does NOT accept a REQUEST-style signature (which signs the http method too)', () => {
    const requestStyle = hexThenBase64(SECRET_KEY, `post${toSign()}`);

    expect(verify({ signature: requestStyle })).toBe(false);
  });

  it.each([
    [
      'a tampered body',
      { rawBody: RAW_BODY.replace('payment_abc', 'payment_x') },
    ],
    [
      'a different webhook URL',
      { webhookUrl: 'https://evil.example/webhooks/rapyd/ar' },
    ],
    ['a different country route', { webhookUrl: URL.replace('/ar', '/co') }],
    ['another secret key', { secretKey: 'some-other-secret' }],
    ['a different salt', { salt: 'othersalt' }],
    ['a different timestamp', { timestamp: '1' }],
    ['a garbage signature', { signature: 'not-a-signature' }],
  ] as const)('rejects %s', (_label, overrides) => {
    expect(verify(overrides)).toBe(false);
  });

  it.each([
    ['signature', { signature: undefined }],
    ['salt', { salt: undefined }],
    ['timestamp', { timestamp: undefined }],
  ] as const)(
    'rejects a missing %s header without throwing',
    (_l, overrides) => {
      expect(verify(overrides)).toBe(false);
    },
  );

  it('tolerates a trailing slash on the configured URL (either form of the URL verifies)', () => {
    const signedWithSlash = hexThenBase64(SECRET_KEY, toSign(`${URL}/`));

    expect(verify({ signature: signedWithSlash })).toBe(true);
  });

  it('verifies a body that arrived pretty-printed by its COMPACT form (Rapyd signs the compact string)', () => {
    const prettyBody = JSON.stringify(JSON.parse(RAW_BODY), null, 2);

    expect(prettyBody).not.toBe(RAW_BODY);
    expect(verify({ rawBody: prettyBody })).toBe(true);
  });

  it('never throws on a non-JSON body — it just cannot match', () => {
    expect(verify({ rawBody: 'not json at all' })).toBe(false);
  });
});
