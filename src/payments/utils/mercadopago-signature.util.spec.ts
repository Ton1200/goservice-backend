import {
  buildMercadoPagoSignatureManifest,
  computeMercadoPagoSignature,
  verifyMercadoPagoSignature,
} from './mercadopago-signature.util';

// Clearly synthetic — never a real webhook secret.
const SECRET = 'unit-test-webhook-secret';
const DATA_ID = 'ORD01M28P44G5FG8RJPM579EH56FV';
const REQUEST_ID = '2066ca19-c6f1-498a-be75-1923005edd06';
const TS = '1742505638683';

function signedHeader(manifest: string, ts = TS): string {
  return `ts=${ts},v1=${computeMercadoPagoSignature(SECRET, manifest)}`;
}

describe('buildMercadoPagoSignatureManifest', () => {
  it('lower-cases data.id and follows the documented id/request-id/ts template', () => {
    expect(
      buildMercadoPagoSignatureManifest({
        dataId: DATA_ID,
        xRequestId: REQUEST_ID,
        ts: TS,
      }),
    ).toBe(`id:${DATA_ID.toLowerCase()};request-id:${REQUEST_ID};ts:${TS};`);
  });

  it('drops a part whose value is absent, per the documentation', () => {
    expect(
      buildMercadoPagoSignatureManifest({
        dataId: null,
        xRequestId: REQUEST_ID,
        ts: TS,
      }),
    ).toBe(`request-id:${REQUEST_ID};ts:${TS};`);
    expect(
      buildMercadoPagoSignatureManifest({
        dataId: DATA_ID,
        xRequestId: undefined,
        ts: TS,
      }),
    ).toBe(`id:${DATA_ID.toLowerCase()};ts:${TS};`);
  });
});

describe('verifyMercadoPagoSignature', () => {
  const manifest = buildMercadoPagoSignatureManifest({
    dataId: DATA_ID,
    xRequestId: REQUEST_ID,
    ts: TS,
  });

  it('accepts a correctly signed notification', () => {
    expect(
      verifyMercadoPagoSignature(SECRET, {
        xSignature: signedHeader(manifest),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toBe(true);
  });

  it('accepts a data.id sent in upper case (the manifest lower-cases it)', () => {
    expect(
      verifyMercadoPagoSignature(SECRET, {
        xSignature: signedHeader(manifest),
        xRequestId: REQUEST_ID,
        dataId: DATA_ID.toUpperCase(),
      }),
    ).toBe(true);
  });

  it('accepts a notification delivered without x-request-id when it was signed without one', () => {
    const noRequestIdManifest = buildMercadoPagoSignatureManifest({
      dataId: DATA_ID,
      xRequestId: undefined,
      ts: TS,
    });
    expect(
      verifyMercadoPagoSignature(SECRET, {
        xSignature: signedHeader(noRequestIdManifest),
        xRequestId: undefined,
        dataId: DATA_ID,
      }),
    ).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    const forged = `ts=${TS},v1=${computeMercadoPagoSignature('another-secret', manifest)}`;
    expect(
      verifyMercadoPagoSignature(SECRET, {
        xSignature: forged,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toBe(false);
  });

  it('rejects a valid signature replayed against a DIFFERENT order id', () => {
    expect(
      verifyMercadoPagoSignature(SECRET, {
        xSignature: signedHeader(manifest),
        xRequestId: REQUEST_ID,
        dataId: 'ORD_SOME_OTHER_ORDER',
      }),
    ).toBe(false);
  });

  it('rejects a tampered ts', () => {
    expect(
      verifyMercadoPagoSignature(SECRET, {
        xSignature: `ts=999,v1=${computeMercadoPagoSignature(SECRET, manifest)}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toBe(false);
  });

  it.each([
    [undefined],
    [''],
    ['garbage'],
    ['ts=123'],
    ['v1=abc'],
    ['ts=,v1='],
    [`ts=${TS},v1=short`],
  ])('rejects a missing/malformed header %p without throwing', (xSignature) => {
    expect(
      verifyMercadoPagoSignature(SECRET, {
        xSignature,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
      }),
    ).toBe(false);
  });
});
