import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verification of Mercado Pago's `x-signature` header on an asynchronous
 * `order` notification. Implements the algorithm from Mercado Pago's current
 * Orders webhook documentation (checked via the official MCP
 * `search_documentation`, 2026-09-18):
 *
 * 1. Split the header on `,` into `ts=<ms>` and `v1=<hex hmac>`.
 * 2. Build the manifest `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 *    where `data.id` comes from the URL's QUERY string (not the body) and is
 *    LOWER-CASED (`ORD01M2…` → `ord01m2…`); any part whose value is absent
 *    from the request is dropped from the manifest entirely.
 * 3. HMAC-SHA256 the manifest with the application's webhook secret, hex
 *    encoded, and compare with `v1`.
 *
 * NOT verified live: the webhook needs a public HTTPS URL, which this
 * environment doesn't have (GOS-85 report) — so this is covered by unit tests
 * against the documented algorithm, not against a real Mercado Pago delivery.
 *
 * There is deliberately no timestamp-freshness window: a replayed
 * notification is harmless here because `HandleMercadoPagoNotificationService`
 * never trusts the body — it re-reads the order from Mercado Pago and applies
 * it through an idempotent, CAS-guarded path.
 */

export interface MercadoPagoSignatureInput {
  /** The raw `x-signature` header value, if any. */
  xSignature: string | undefined;
  /** The `x-request-id` header value, if any. */
  xRequestId: string | undefined;
  /** The `data.id` query-string value, if any. */
  dataId: string | null | undefined;
}

function parseSignatureHeader(
  header: string,
): { ts: string; v1: string } | null {
  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key === 'ts') {
      ts = value;
    } else if (key === 'v1') {
      v1 = value;
    }
  }
  return ts && v1 ? { ts, v1 } : null;
}

export function buildMercadoPagoSignatureManifest(input: {
  dataId: string | null | undefined;
  xRequestId: string | undefined;
  ts: string;
}): string {
  let manifest = '';
  if (input.dataId) {
    manifest += `id:${input.dataId.toLowerCase()};`;
  }
  if (input.xRequestId) {
    manifest += `request-id:${input.xRequestId};`;
  }
  manifest += `ts:${input.ts};`;
  return manifest;
}

export function computeMercadoPagoSignature(
  secret: string,
  manifest: string,
): string {
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

/** `false` for ANY failure (missing/malformed header, wrong length, mismatch) — never throws. */
export function verifyMercadoPagoSignature(
  secret: string,
  input: MercadoPagoSignatureInput,
): boolean {
  if (!input.xSignature) {
    return false;
  }
  const parsed = parseSignatureHeader(input.xSignature);
  if (!parsed) {
    return false;
  }
  const expected = computeMercadoPagoSignature(
    secret,
    buildMercadoPagoSignatureManifest({
      dataId: input.dataId,
      xRequestId: input.xRequestId,
      ts: parsed.ts,
    }),
  );
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(parsed.v1, 'utf8');
  // `timingSafeEqual` throws on a length mismatch, so guard it first.
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
