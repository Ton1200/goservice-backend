import { createHmac } from 'crypto';
import {
  CountryCode,
  IdentityDocumentType,
  IdentityVerificationStatus,
} from '@prisma/client';
import { DomainException } from '../../common/errors/domain-exception';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import { DiditIdentityVerificationAdapter } from './didit-identity-verification.adapter';
import {
  diditAbandonedWebhookPayload,
  diditApprovedWebhookPayload,
  diditBiometricRejectedWebhookPayload,
  diditDocumentRejectedWebhookPayload,
  diditInProgressWebhookPayload,
} from './didit-webhook-payload.fixtures';

const SANDBOX_SETTINGS: Record<string, string> = {
  'identity.didit.mode': 'SANDBOX',
  'identity.didit.sandbox.api-key': 'sandbox-api-key',
  'identity.didit.sandbox.workflow-id': 'sandbox-workflow-id',
  'identity.didit.sandbox.webhook-secret': 'sandbox-webhook-secret',
};

function buildPlatformSettingPort(
  overrides: Record<string, string | null> = {},
): jest.Mocked<PlatformSettingPort> {
  const values: Record<string, string | null> = {
    ...SANDBOX_SETTINGS,
    ...overrides,
  };
  return {
    isEnabled: jest.fn((key: string) =>
      Promise.resolve(values[key] === 'true'),
    ),
    getValue: jest.fn((key: string) => Promise.resolve(values[key] ?? null)),
  };
}

/** Minimal shape of the one `fetch(url, init)` call this adapter ever makes
 * — used only to type-narrow `fetchMock.mock.calls[0]` for assertions
 * below, never a real `RequestInit`. */
interface CapturedFetchCall {
  url: string;
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  };
}

function capturedCall(fetchMock: jest.Mock): CapturedFetchCall {
  const [url, init] = fetchMock.mock.calls[0] as [
    string,
    CapturedFetchCall['init'],
  ];
  return { url, init };
}

/** A minimal fetch-`Response`-shaped stub — only the 3 members this
 * adapter ever reads (`ok`/`status`/`json()`). */
function fakeResponse(options: {
  ok: boolean;
  status: number;
  body?: unknown;
}): { ok: boolean; status: number; json: () => Promise<unknown> } {
  return {
    ok: options.ok,
    status: options.status,
    json: () => Promise.resolve(options.body ?? {}),
  };
}

describe('DiditIdentityVerificationAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('createSession', () => {
    it('POSTs to the Didit session endpoint with the active mode credentials and never calls the real network', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        fakeResponse({
          ok: true,
          status: 201,
          body: {
            session_id: 'session-123',
            url: 'https://verify.didit.me/session-123',
            session_token: 'token-abc',
            status: 'Not Started',
            workflow_id: 'sandbox-workflow-id',
            vendor_data: 'iv-1',
          },
        }),
      );
      global.fetch = fetchMock;

      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort(),
      );

      const session = await adapter.createSession({
        identityVerificationId: 'iv-1',
        country: CountryCode.AR,
      });

      expect(session).toEqual({
        providerReference: 'session-123',
        verificationUrl: 'https://verify.didit.me/session-123',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const { url, init } = capturedCall(fetchMock);
      expect(url).toBe('https://verification.didit.me/v3/session/');
      expect(init.method).toBe('POST');
      expect(init.headers['x-api-key']).toBe('sandbox-api-key');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body)).toEqual({
        workflow_id: 'sandbox-workflow-id',
        vendor_data: 'iv-1',
      });
    });

    it('throws IDENTITY_VERIFICATION_MISCONFIGURED without calling fetch when the active mode is missing an api-key', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort({ 'identity.didit.sandbox.api-key': null }),
      );

      await expect(
        adapter.createSession({
          identityVerificationId: 'iv-1',
          country: CountryCode.AR,
        }),
      ).rejects.toMatchObject<Partial<DomainException>>({
        code: 'IDENTITY_VERIFICATION_MISCONFIGURED',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws IDENTITY_VERIFICATION_MISCONFIGURED without calling fetch when the active mode is missing a workflow-id', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort({
          'identity.didit.sandbox.workflow-id': null,
        }),
      );

      await expect(
        adapter.createSession({
          identityVerificationId: 'iv-1',
          country: CountryCode.AR,
        }),
      ).rejects.toMatchObject<Partial<DomainException>>({
        code: 'IDENTITY_VERIFICATION_MISCONFIGURED',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reads the PRODUCTION credential set when identity.didit.mode is PRODUCTION', async () => {
      const fetchMock = jest.fn().mockResolvedValue(
        fakeResponse({
          ok: true,
          status: 201,
          body: {
            session_id: 'session-prod',
            url: 'https://verify.didit.me/session-prod',
          },
        }),
      );
      global.fetch = fetchMock;

      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort({
          'identity.didit.mode': 'PRODUCTION',
          'identity.didit.production.api-key': 'prod-api-key',
          'identity.didit.production.workflow-id': 'prod-workflow-id',
        }),
      );

      await adapter.createSession({
        identityVerificationId: 'iv-2',
        country: CountryCode.CO,
      });

      const { init } = capturedCall(fetchMock);
      expect(init.headers['x-api-key']).toBe('prod-api-key');
      expect(
        (JSON.parse(init.body) as { workflow_id: string }).workflow_id,
      ).toBe('prod-workflow-id');
    });

    it('throws IDENTITY_VERIFICATION_PROVIDER_ERROR on a non-2xx response', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(fakeResponse({ ok: false, status: 500 }));

      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort(),
      );

      await expect(
        adapter.createSession({
          identityVerificationId: 'iv-1',
          country: CountryCode.AR,
        }),
      ).rejects.toMatchObject<Partial<DomainException>>({
        code: 'IDENTITY_VERIFICATION_PROVIDER_ERROR',
      });
    });

    it('throws IDENTITY_VERIFICATION_PROVIDER_ERROR on a network failure', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort(),
      );

      await expect(
        adapter.createSession({
          identityVerificationId: 'iv-1',
          country: CountryCode.AR,
        }),
      ).rejects.toMatchObject<Partial<DomainException>>({
        code: 'IDENTITY_VERIFICATION_PROVIDER_ERROR',
      });
    });
  });

  describe('translateWebhookPayload', () => {
    const adapter = new DiditIdentityVerificationAdapter(
      buildPlatformSettingPort(),
    );

    it('maps a fully-approved decision to APPROVED, both checks true', () => {
      const result = adapter.translateWebhookPayload(
        diditApprovedWebhookPayload('iv-1'),
      );
      expect(result).toEqual({
        providerReference: 'b1c2d3e4-0000-4000-8000-000000000002',
        documentCheckPassed: true,
        biometricCheckPassed: true,
        documentType: IdentityDocumentType.NATIONAL_ID,
        status: IdentityVerificationStatus.APPROVED,
      });
    });

    it('maps a document-rejected decision to REJECTED, documentCheckPassed false', () => {
      const result = adapter.translateWebhookPayload(
        diditDocumentRejectedWebhookPayload('iv-1'),
      );
      expect(result.documentCheckPassed).toBe(false);
      expect(result.biometricCheckPassed).toBe(true);
      expect(result.status).toBe(IdentityVerificationStatus.REJECTED);
    });

    it('maps a biometric-rejected decision to REJECTED, biometricCheckPassed false', () => {
      const result = adapter.translateWebhookPayload(
        diditBiometricRejectedWebhookPayload('iv-1'),
      );
      expect(result.documentCheckPassed).toBe(true);
      expect(result.biometricCheckPassed).toBe(false);
      expect(result.status).toBe(IdentityVerificationStatus.REJECTED);
      expect(result.documentType).toBe(IdentityDocumentType.PASSPORT);
    });

    it('maps an In Progress event (no decision object) to PENDING, both checks null', () => {
      const result = adapter.translateWebhookPayload(
        diditInProgressWebhookPayload('iv-1'),
      );
      expect(result.documentCheckPassed).toBeNull();
      expect(result.biometricCheckPassed).toBeNull();
      expect(result.status).toBe(IdentityVerificationStatus.PENDING);
      expect(result.documentType).toBe(IdentityDocumentType.UNKNOWN);
    });

    it('maps an Abandoned event (no decision object) to PENDING', () => {
      const result = adapter.translateWebhookPayload(
        diditAbandonedWebhookPayload('iv-1'),
      );
      expect(result.status).toBe(IdentityVerificationStatus.PENDING);
    });
  });

  describe('verifyWebhookSignature', () => {
    function sign(secret: string, rawBody: string): string {
      return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    }

    it('accepts a correctly-signed payload within the timestamp window', async () => {
      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort(),
      );
      const rawBody = JSON.stringify({ hello: 'world' });
      const nowSeconds = Math.floor(Date.now() / 1000);
      const signature = sign('sandbox-webhook-secret', rawBody);

      const valid = await adapter.verifyWebhookSignature(rawBody, {
        'x-signature-v2': signature,
        'x-timestamp': String(nowSeconds),
      });
      expect(valid).toBe(true);
    });

    it('rejects a payload with a wrong signature', async () => {
      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort(),
      );
      const rawBody = JSON.stringify({ hello: 'world' });
      const nowSeconds = Math.floor(Date.now() / 1000);

      const valid = await adapter.verifyWebhookSignature(rawBody, {
        'x-signature-v2': 'not-the-real-signature',
        'x-timestamp': String(nowSeconds),
      });
      expect(valid).toBe(false);
    });

    it('rejects a payload whose X-Timestamp is outside the 300s window', async () => {
      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort(),
      );
      const rawBody = JSON.stringify({ hello: 'world' });
      const staleSeconds = Math.floor(Date.now() / 1000) - 301;
      const signature = sign('sandbox-webhook-secret', rawBody);

      const valid = await adapter.verifyWebhookSignature(rawBody, {
        'x-signature-v2': signature,
        'x-timestamp': String(staleSeconds),
      });
      expect(valid).toBe(false);
    });

    it('rejects when no signature/timestamp header is present', async () => {
      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort(),
      );
      const valid = await adapter.verifyWebhookSignature(
        JSON.stringify({ hello: 'world' }),
        {},
      );
      expect(valid).toBe(false);
    });

    it('rejects when no webhook secret is configured for the active mode (fails closed)', async () => {
      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort({
          'identity.didit.sandbox.webhook-secret': null,
        }),
      );
      const rawBody = JSON.stringify({ hello: 'world' });
      const nowSeconds = Math.floor(Date.now() / 1000);
      const signature = sign('sandbox-webhook-secret', rawBody);

      const valid = await adapter.verifyWebhookSignature(rawBody, {
        'x-signature-v2': signature,
        'x-timestamp': String(nowSeconds),
      });
      expect(valid).toBe(false);
    });

    // Demonstrates WHY `verifyWebhookSignature` must be given the pristine
    // raw request bytes (`req.rawBody`), never a re-parsed/re-stringified
    // version of the body (e.g. `JSON.stringify(req.body)`): this function
    // computes HMAC over EXACTLY the string it's given, with no
    // canonicalization of its own. A logically-identical payload
    // re-serialized with a different key order produces a DIFFERENT raw
    // byte string, and therefore a signature computed over the ORIGINAL
    // bytes will correctly fail against the RE-SERIALIZED bytes — proving
    // this function does not (and must not) tolerate that kind of
    // reordering itself; it depends entirely on the controller passing the
    // real, untouched request body. See `DiditWebhookController` and
    // `main.ts`'s `rawBody: true` bootstrap option.
    it('fails when verified against a re-serialized (different byte-for-byte) copy of an otherwise-identical payload', async () => {
      const adapter = new DiditIdentityVerificationAdapter(
        buildPlatformSettingPort(),
      );
      const originalRawBody = JSON.stringify({ a: 1, b: 2 });
      const reserializedRawBody = JSON.stringify({ b: 2, a: 1 });
      expect(reserializedRawBody).not.toBe(originalRawBody);

      const nowSeconds = Math.floor(Date.now() / 1000);
      const signature = sign('sandbox-webhook-secret', originalRawBody);

      const valid = await adapter.verifyWebhookSignature(reserializedRawBody, {
        'x-signature-v2': signature,
        'x-timestamp': String(nowSeconds),
      });
      expect(valid).toBe(false);
    });
  });
});
