import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { IdentityDocumentType } from '@prisma/client';
import { PlatformSettingPort } from '../../platform-admin/platform-settings/ports/platform-setting.port';
import {
  diditModeSettingKeys,
  parseDiditMode,
  IDENTITY_PLATFORM_SETTING_KEYS,
} from '../constants/didit-settings.constants';
import { identityVerificationMisconfigured } from '../errors/identity-verification-misconfigured.error';
import { identityVerificationProviderError } from '../errors/identity-verification-provider-error.error';
import {
  CreateIdentityVerificationSessionCommand,
  IdentityVerificationPort,
  IdentityVerificationResult,
  IdentityVerificationSession,
} from '../ports/identity-verification.port';
import { resolveIdentityVerificationStatus } from '../services/resolve-identity-verification-status.util';

const DIDIT_CREATE_SESSION_URL = 'https://verification.didit.me/v3/session/';

/** Anti-replay window for `X-Timestamp` — see this class's own
 * `verifyWebhookSignature` comment. */
const WEBHOOK_TIMESTAMP_WINDOW_SECONDS = 300;

/**
 * Best-effort mapping from Didit's own free-text `document_type` (reported
 * only AFTER capture, via the webhook's `decision.id_verifications[]` — see
 * `translateWebhookPayload`) to our own `IdentityDocumentType` enum. Didit's
 * public documentation only confirms ONE concrete example value
 * (`"Identity Card"`, see the implementation plan's section 2) — every
 * other mapping below is a reasonable, case-insensitive best guess at the
 * likely label shape, not a confirmed value from Didit's own docs. Anything
 * that doesn't match falls back to `UNKNOWN` (the column's own DB default)
 * rather than throwing — an unrecognized label must never break webhook
 * processing.
 */
const DOCUMENT_TYPE_KEYWORD_MAP: ReadonlyArray<{
  keyword: string;
  documentType: IdentityDocumentType;
}> = [
  { keyword: 'passport', documentType: IdentityDocumentType.PASSPORT },
  {
    keyword: 'driver',
    documentType: IdentityDocumentType.DRIVERS_LICENSE,
  },
  {
    keyword: 'residence',
    documentType: IdentityDocumentType.FOREIGN_ID,
  },
  {
    keyword: 'foreign',
    documentType: IdentityDocumentType.FOREIGN_ID,
  },
  {
    keyword: 'identity',
    documentType: IdentityDocumentType.NATIONAL_ID,
  },
  { keyword: 'national', documentType: IdentityDocumentType.NATIONAL_ID },
];

/** Shape of a Didit `status.updated` webhook event this adapter reads —
 * defensively typed as `unknown`-derived, never trusted as-is (see
 * `translateWebhookPayload`). */
interface DiditWebhookCheckResult {
  status?: unknown;
}
interface DiditWebhookIdVerification extends DiditWebhookCheckResult {
  document_type?: unknown;
}
interface DiditWebhookDecision {
  id_verifications?: DiditWebhookIdVerification[];
  liveness_checks?: DiditWebhookCheckResult[];
  face_matches?: DiditWebhookCheckResult[];
}
interface DiditWebhookPayload {
  event_id?: unknown;
  webhook_type?: unknown;
  session_id?: unknown;
  vendor_data?: unknown;
  status?: unknown;
  decision?: DiditWebhookDecision;
}

const DIDIT_CHECK_APPROVED = 'Approved';

/**
 * The single, real integration with Didit (docs.didit.me) — every other
 * class in `src/identity-verification/` is provider-agnostic and never
 * imports this class directly except via `IdentityVerificationPort`
 * (`IdentityVerificationProviderRegistry`) or, for the webhook path, this
 * concrete class on purpose (`DiditWebhookController`/
 * `HandleIdentityVerificationWebhookService` — the webhook route itself is
 * already provider-specific, `/webhooks/didit/...`, so there is no
 * abstraction to preserve there).
 *
 * Uses Node's global `fetch` (no `axios`/`got` — this codebase has no HTTP
 * client dependency today, and the implementation plan explicitly
 * recommends not adding one for this single call shape) and Node's built-in
 * `crypto` (HMAC-SHA256, `timingSafeEqual`) for webhook signature
 * verification — no new dependency for either.
 *
 * Every credential/mode read happens LIVE, per-call, via
 * `PlatformSettingPort` — never cached, never read once at construction —
 * same discipline `ResendEmailClientAdapter.send()` already established for
 * this exact reason (an admin rotating a key/switching SANDBOX<->PRODUCTION
 * must take effect on the very next call, not after a restart).
 */
@Injectable()
export class DiditIdentityVerificationAdapter implements IdentityVerificationPort {
  private readonly logger = new Logger(DiditIdentityVerificationAdapter.name);

  constructor(private readonly platformSettingPort: PlatformSettingPort) {}

  async createSession(
    command: CreateIdentityVerificationSessionCommand,
  ): Promise<IdentityVerificationSession> {
    const mode = parseDiditMode(
      await this.platformSettingPort.getValue(
        IDENTITY_PLATFORM_SETTING_KEYS.diditMode,
      ),
    );
    const { apiKey, workflowId } = diditModeSettingKeys(mode);
    const [resolvedApiKey, resolvedWorkflowId] = await Promise.all([
      this.platformSettingPort.getValue(apiKey),
      this.platformSettingPort.getValue(workflowId),
    ]);

    if (!resolvedApiKey || !resolvedWorkflowId) {
      throw identityVerificationMisconfigured();
    }

    let response: Response;
    try {
      response = await fetch(DIDIT_CREATE_SESSION_URL, {
        method: 'POST',
        headers: {
          'x-api-key': resolvedApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_id: resolvedWorkflowId,
          vendor_data: command.identityVerificationId,
          // `callback` (the post-verification browser redirect) is
          // intentionally never sent — GOS-33 is backend-only and no mobile
          // deep-link/screen exists yet to redirect to (a future mobile
          // story's concern, tracked in DEC-006). Result delivery doesn't
          // depend on it at all — that's the webhook's job
          // (`translateWebhookPayload`/`verifyWebhookSignature` below),
          // which is unaffected either way. Didit falls back to its own
          // generic completion page when `callback` is omitted.
        }),
      });
    } catch {
      this.logger.warn({
        event: 'identity_verification_provider_call_failed',
        provider: 'didit',
        reason: 'network_error',
      });
      throw identityVerificationProviderError();
    }

    if (!response.ok) {
      this.logger.warn({
        event: 'identity_verification_provider_call_failed',
        provider: 'didit',
        reason: 'non_2xx_response',
        statusCode: response.status,
      });
      throw identityVerificationProviderError();
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.logger.warn({
        event: 'identity_verification_provider_call_failed',
        provider: 'didit',
        reason: 'unparsable_response_body',
      });
      throw identityVerificationProviderError();
    }

    const sessionId = this.stringField(body, 'session_id');
    const url = this.stringField(body, 'url');
    if (!sessionId || !url) {
      this.logger.warn({
        event: 'identity_verification_provider_call_failed',
        provider: 'didit',
        reason: 'missing_expected_fields',
      });
      throw identityVerificationProviderError();
    }

    return { providerReference: sessionId, verificationUrl: url };
  }

  translateWebhookPayload(rawPayload: unknown): IdentityVerificationResult {
    const payload = this.asDiditWebhookPayload(rawPayload);

    const providerReference = this.optionalString(payload.session_id) ?? '';
    const decision = payload.decision;

    let documentCheckPassed: boolean | null = null;
    let biometricCheckPassed: boolean | null = null;
    let documentType: IdentityDocumentType = IdentityDocumentType.UNKNOWN;

    if (decision) {
      const idVerifications = decision.id_verifications ?? [];
      const livenessChecks = decision.liveness_checks ?? [];
      const faceMatches = decision.face_matches ?? [];

      documentCheckPassed =
        idVerifications.length > 0 &&
        idVerifications.every((check) => this.isApproved(check));
      biometricCheckPassed =
        livenessChecks.length > 0 &&
        faceMatches.length > 0 &&
        livenessChecks.every((check) => this.isApproved(check)) &&
        faceMatches.every((check) => this.isApproved(check));

      const reportedDocumentType = idVerifications
        .map((check) => this.optionalString(check.document_type))
        .find((value): value is string => value !== null);
      if (reportedDocumentType) {
        documentType = this.mapDocumentType(reportedDocumentType);
      }
    }

    return {
      providerReference,
      documentCheckPassed,
      biometricCheckPassed,
      documentType,
      status: resolveIdentityVerificationStatus(
        documentCheckPassed,
        biometricCheckPassed,
      ),
    };
  }

  async verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
  ): Promise<boolean> {
    // Header names arrive lowercased — Node's own `http`/Express
    // normalizes every incoming header key to lowercase before NestJS's
    // `@Headers()` decorator ever sees it, so this never needs a
    // case-insensitive lookup.
    const signatureHeader = headers['x-signature-v2'];
    const timestampHeader = headers['x-timestamp'];
    if (!signatureHeader || !timestampHeader) {
      return false;
    }

    const timestampSeconds = Number(timestampHeader);
    if (!Number.isFinite(timestampSeconds)) {
      return false;
    }
    const nowSeconds = Date.now() / 1000;
    if (
      Math.abs(nowSeconds - timestampSeconds) > WEBHOOK_TIMESTAMP_WINDOW_SECONDS
    ) {
      return false;
    }

    const mode = parseDiditMode(
      await this.platformSettingPort.getValue(
        IDENTITY_PLATFORM_SETTING_KEYS.diditMode,
      ),
    );
    const { webhookSecret } = diditModeSettingKeys(mode);
    const secret = await this.platformSettingPort.getValue(webhookSecret);
    if (!secret) {
      // No webhook secret configured for the active mode — fail closed,
      // never treat an unverifiable signature as valid.
      return false;
    }

    const expectedSignature = createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuffer.length !== receivedBuffer.length) {
      // `timingSafeEqual` throws on mismatched lengths — this codebase
      // never lets a thrown error double as "signature invalid" implicitly
      // (see the try/catch precedent in `JoseSocialIdentityValidationAdapter`),
      // so length is checked explicitly first.
      return false;
    }
    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  private isApproved(check: DiditWebhookCheckResult): boolean {
    return check.status === DIDIT_CHECK_APPROVED;
  }

  private mapDocumentType(rawDocumentType: string): IdentityDocumentType {
    const normalized = rawDocumentType.toLowerCase();
    const match = DOCUMENT_TYPE_KEYWORD_MAP.find(({ keyword }) =>
      normalized.includes(keyword),
    );
    return match?.documentType ?? IdentityDocumentType.UNKNOWN;
  }

  private asDiditWebhookPayload(rawPayload: unknown): DiditWebhookPayload {
    return typeof rawPayload === 'object' && rawPayload !== null
      ? rawPayload
      : {};
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private stringField(body: unknown, field: string): string | null {
    if (typeof body !== 'object' || body === null) {
      return null;
    }
    return this.optionalString((body as Record<string, unknown>)[field]);
  }
}
