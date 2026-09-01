import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import {
  AttachmentUploadTarget,
  CreateAttachmentUploadUrlCommand,
  StoragePort,
} from '../ports/storage.port';

/** How long an issued `uploadUrl` accepts a PUT before it's rejected. */
const UPLOAD_URL_TTL_MINUTES = 30;

const CONTENT_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * The exact inverse of `CONTENT_TYPE_EXTENSIONS` above — used by
 * `UploadsController.get` to answer the response with the real
 * `Content-Type` instead of Express's `res.send(Buffer)` default
 * (`application/octet-stream`). Bug found 2026-08-25 (uploadable-logo
 * follow-up): with the wrong content-type, `GET /uploads/:key` still
 * returns the correct bytes (a raw byte-count check like `curl` never
 * notices), but a BROWSER refuses to treat the response as an image —
 * `<img src="...">` tags render broken, exactly what surfaced as a missing
 * logo in a real sent email. `X-Content-Type-Options: nosniff` (set
 * globally by Helmet — see `apply-security-middleware.ts`) makes this
 * strict, not just a Chrome heuristic quirk: the browser is told not to
 * guess, so an honest, correct header is required, not optional.
 */
const EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(CONTENT_TYPE_EXTENSIONS).map(([contentType, ext]) => [
      ext,
      contentType,
    ]),
  );

/**
 * LOCAL DEV/TEST ONLY placeholder implementation of `StoragePort` — writes
 * to a local `./var/uploads/` directory and serves files back via
 * `UploadsController`. Replace with a real object-storage adapter
 * (S3/Cloudinary/Azure Blob) once that infrastructure decision is made (see
 * infrastructure.md's open hosting-provider question); this adapter's only
 * job is to make `requestServiceRequestAttachmentUploadUrl`/
 * `publishServiceRequest` real and testable today. Same "no real provider
 * decided yet, seam built now" posture already established for
 * `CustomerProfile.photoUrl`/`ProfessionalProfile.photoUrl`.
 *
 * Upload tokens are HMAC-SHA256-signed over `key:expiresAtMillis`, verified
 * with `timingSafeEqual` — same signing/verification discipline
 * `DiditIdentityVerificationAdapter.verifyWebhookSignature` already
 * establishes for this codebase. The signing secret is read from
 * `ConfigService` (`storageLocal.signingSecret`) when set; otherwise a
 * fresh random secret is generated once at construction and held for this
 * adapter instance's lifetime (the whole app process) — acceptable for a
 * local-dev/test-only seam protecting nothing but a throwaway local file,
 * mirroring `test/support/test-app.ts`'s own ephemeral-secret precedent for
 * `ADMIN_CREDENTIALS_ENCRYPTION_KEY`.
 */
@Injectable()
export class LocalDevStorageAdapter implements StoragePort {
  private readonly signingSecret: string;
  private readonly uploadsDir = join(process.cwd(), 'var', 'uploads');

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    this.signingSecret =
      this.configService.get('storageLocal', { infer: true }).signingSecret ??
      randomBytes(32).toString('hex');
  }

  // Not `async` — nothing here awaits (no real network/disk call is needed
  // to compose these URLs); `StoragePort.createUploadUrl`'s signature stays
  // `Promise`-returning because a real object-storage adapter (S3/etc.)
  // will genuinely need to await a provider call.
  createUploadUrl(
    command: CreateAttachmentUploadUrlCommand,
  ): Promise<AttachmentUploadTarget> {
    const extension = CONTENT_TYPE_EXTENSIONS[command.contentType] ?? '';
    const key = `${randomBytes(16).toString('hex')}${extension}`;
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MINUTES * 60_000);
    const token = this.signToken(key, expiresAt.getTime());
    const baseUrl = this.configService.get('storageLocal', {
      infer: true,
    }).baseUrl;

    return Promise.resolve({
      uploadUrl: `${baseUrl}/uploads/${key}?token=${token}&expires=${expiresAt.getTime()}`,
      publicUrl: `${baseUrl}/uploads/${key}`,
      expiresAt,
    });
  }

  /** Used by `UploadsController.put` before accepting bytes for `key`. */
  verifyUploadToken(
    key: string,
    expiresAtMillis: number,
    token: string,
  ): boolean {
    if (!Number.isFinite(expiresAtMillis) || Date.now() > expiresAtMillis) {
      return false;
    }
    const expected = this.signToken(key, expiresAtMillis);
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(token, 'utf8');
    if (expectedBuffer.length !== receivedBuffer.length) {
      // `timingSafeEqual` throws on mismatched lengths — checked explicitly
      // first, same precedent as `DiditIdentityVerificationAdapter`.
      return false;
    }
    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  /** Used by `UploadsController.put` — writes the raw bytes for `key`. */
  async writeFile(key: string, bytes: Buffer): Promise<void> {
    await mkdir(this.uploadsDir, { recursive: true });
    await writeFile(this.pathFor(key), bytes);
  }

  /** Used by `UploadsController.get` — `null` if `key` was never written. */
  async readFile(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  /**
   * Used by `UploadsController.get` to set the real `Content-Type` response
   * header — see `EXTENSION_CONTENT_TYPES`'s own comment above for why this
   * is a correctness fix, not cosmetic. Falls back to
   * `application/octet-stream` (Express's own default) for any extension
   * outside the allow-list this adapter itself ever writes.
   */
  getContentType(key: string): string {
    return EXTENSION_CONTENT_TYPES[extname(key)] ?? 'application/octet-stream';
  }

  private pathFor(key: string): string {
    // `key` is always one of OUR OWN `randomBytes(16).toString('hex')`
    // (+ a fixed allow-listed extension) values — never client-chosen —
    // but this is still checked defensively so a malformed/foreign `key`
    // (e.g. containing `..`/`/`) can never escape `uploadsDir`.
    if (!/^[a-f0-9]{32}(\.[a-z]+)?$/.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return join(this.uploadsDir, key);
  }

  private signToken(key: string, expiresAtMillis: number): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${key}:${expiresAtMillis}`, 'utf8')
      .digest('hex');
  }
}
