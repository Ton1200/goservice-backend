import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Rapyd's two signature schemes — pure functions, so both are testable with
 * zero NestJS/network machinery (same posture as `mercadopago-signature.util.ts`).
 *
 * ## 1. Signing a REQUEST to Rapyd
 *
 * `signature = BASE64( HEX( HMAC-SHA256( secretKey, method_lowercase + urlPath +
 * salt + timestamp + accessKey + secretKey + body ) ) )` — note the double
 * encoding: the HMAC digest is turned into a lowercase HEX string first, and
 * the base64 is of THAT string, not of the raw digest bytes.
 *
 * Source: https://docs.rapyd.net/en/request-signatures.html. Derived from the
 * GOS-75 PoC's `signRequest` (`goservice-docs/research/gos-75-mercado-pago-poc/
 * poc-rapyd/src/rapyd-poc.ts`), where every call authenticated against the real
 * sandbox. Rules that bite: `urlPath` INCLUDES `/v1` and the query string; the
 * body is the EXACT compact JSON string that is sent, and is `""` (never `{}`)
 * for a request without a body; the timestamp (unix seconds) must be within
 * 60 s of Rapyd's clock.
 *
 * ## 2. Verifying a WEBHOOK from Rapyd
 *
 * `signature = BASE64( HASH( url_path + salt + timestamp + access_key +
 * secret_key + body_string ) )`, HASH = HMAC-SHA256 keyed with `secret_key`
 * (https://docs.rapyd.net/en/webhook-authentication.html). This is NOT the
 * request-signature formula: there is no HTTP method, and `url_path` is "the
 * entire URL that was configured for your company to receive webhooks" — the
 * full public URL, scheme and host included, exactly as entered in Rapyd's
 * Client Portal. `salt` and `timestamp` come from the webhook's own headers.
 *
 * What Rapyd's page does NOT say (so it is NOT verified here — only exercised
 * with synthetic vectors, no real delivery has ever been observed, since no
 * public HTTPS URL exists in any environment yet):
 * - the header NAMES (`salt`, `timestamp`, `signature` are used — the same
 *   names as the request headers and the ones Rapyd's sample handlers read);
 * - whether the base64 is of the HEX digest (like requests) or of the RAW
 *   digest. Both are accepted: each one still requires the secret key, so
 *   accepting two encodings of the same HMAC does not weaken anything;
 * - a timestamp tolerance (none is documented → none is enforced; a replay is
 *   harmless anyway because the notification body is never trusted — the
 *   caller re-reads the real state from Rapyd's API);
 * - body serialization: the docs say the body has no whitespace outside
 *   strings. The RAW bytes as received are used first; if they differ from
 *   their compact re-serialization (e.g. a proxy pretty-printed them), the
 *   compact form is tried as well.
 * - trailing slash of the configured URL: both forms are tried.
 */

export interface RapydRequestSignatureInput {
  method: string;
  /** Path INCLUDING `/v1` and the `?query` string, if any. */
  urlPath: string;
  /** The exact string sent as the request body; `""` when there is none. */
  body: string;
  accessKey: string;
  secretKey: string;
  /** Injectable for tests; random 16 hex chars / now, by default. */
  salt?: string;
  timestamp?: string;
}

export interface RapydRequestSignature {
  salt: string;
  timestamp: string;
  signature: string;
}

export function signRapydRequest(
  input: RapydRequestSignatureInput,
): RapydRequestSignature {
  const salt = input.salt ?? randomBytes(8).toString('hex');
  const timestamp = input.timestamp ?? String(Math.floor(Date.now() / 1000));
  const toSign =
    input.method.toLowerCase() +
    input.urlPath +
    salt +
    timestamp +
    input.accessKey +
    input.secretKey +
    input.body;
  const hex = createHmac('sha256', input.secretKey)
    .update(toSign)
    .digest('hex');
  return { salt, timestamp, signature: Buffer.from(hex).toString('base64') };
}

export interface RapydWebhookSignatureInput {
  /** The webhook's `signature` header. */
  signature: string | undefined;
  /** The webhook's `salt` header. */
  salt: string | undefined;
  /** The webhook's `timestamp` header (unix seconds). */
  timestamp: string | undefined;
  /**
   * The FULL public URL configured in Rapyd's Client Portal for this webhook
   * (e.g. `https://api.example.com/webhooks/rapyd/ar`) — NOT `req.originalUrl`:
   * behind a proxy the path Nest sees can differ from what Rapyd signed.
   */
  webhookUrl: string;
  /** The raw request body, exactly as received. */
  rawBody: string;
  accessKey: string;
  secretKey: string;
}

/** `false` — never throws — for a missing/malformed/wrong signature. */
export function verifyRapydWebhookSignature(
  input: RapydWebhookSignatureInput,
): boolean {
  const { signature, salt, timestamp } = input;
  if (!signature || !salt || !timestamp) {
    return false;
  }

  const urls = new Set([input.webhookUrl]);
  urls.add(
    input.webhookUrl.endsWith('/')
      ? input.webhookUrl.slice(0, -1)
      : `${input.webhookUrl}/`,
  );

  const bodies = new Set([input.rawBody]);
  const compact = compactJson(input.rawBody);
  if (compact !== null) {
    bodies.add(compact);
  }

  const received = Buffer.from(signature);
  for (const url of urls) {
    for (const body of bodies) {
      const toSign =
        url + salt + timestamp + input.accessKey + input.secretKey + body;
      const digest = createHmac('sha256', input.secretKey)
        .update(toSign)
        .digest();
      const candidates = [
        Buffer.from(digest.toString('hex')).toString('base64'),
        digest.toString('base64'),
      ];
      for (const candidate of candidates) {
        const expected = Buffer.from(candidate);
        if (
          expected.length === received.length &&
          timingSafeEqual(expected, received)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** The body re-serialized without insignificant whitespace, or `null` if it is not JSON. */
function compactJson(raw: string): string | null {
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return null;
  }
}
