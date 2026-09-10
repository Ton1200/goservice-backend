import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
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

/**
 * Sub-directory (under `uploadsDir`) where the RAW, unprocessed bytes of an
 * image upload are parked until the `image-processing` BullMQ worker has
 * resized + re-encoded them to WebP and promoted the result to the public
 * key (GOS-70). Never served: `pathFor`'s key regex rejects anything
 * containing `/`, and `UploadsController.get` only ever reads `pathFor`.
 */
const STAGING_DIR_NAME = '.staging';

/**
 * The `Content-Type` for each extension this adapter ever writes — used by
 * `UploadsController.get` to answer with the real type instead of Express's
 * `res.send(Buffer)` default (`application/octet-stream`). Bug found
 * 2026-08-25 (uploadable-logo follow-up): with the wrong content-type,
 * `GET /uploads/:key` still returns the correct bytes (a raw byte-count
 * check like `curl` never notices), but a BROWSER refuses to treat the
 * response as an image — `<img src="...">` tags render broken. As of
 * GOS-70 every image normalizes to WebP at issue time (see
 * `createUploadUrl`), so the only two extensions in play are `.webp` and
 * `.pdf`.
 */
const EXTENSION_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

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
  /**
   * Absolute directory this adapter writes to. GOS-70: read from config
   * (`storageLocal.uploadsDir`, ultimately `STORAGE_LOCAL_UPLOADS_DIR`)
   * instead of the former hardcoded `join(process.cwd(), 'var', 'uploads')`
   * — `StorageUploadsDirInitializer` has already verified it is writable by
   * the time any request reaches this adapter.
   */
  private readonly uploadsDir: string;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    const storageLocal = this.configService.get('storageLocal', {
      infer: true,
    });
    this.signingSecret =
      storageLocal.signingSecret ?? randomBytes(32).toString('hex');
    this.uploadsDir = storageLocal.uploadsDir;
  }

  // Not `async` — nothing here awaits (no real network/disk call is needed
  // to compose these URLs); `StoragePort.createUploadUrl`'s signature stays
  // `Promise`-returning because a real object-storage adapter (S3/etc.)
  // will genuinely need to await a provider call.
  createUploadUrl(
    command: CreateAttachmentUploadUrlCommand,
  ): Promise<AttachmentUploadTarget> {
    // GOS-70: every image content-type normalizes to a `.webp` key up front
    // — the `image-processing` worker guarantees the stored bytes really
    // are WebP, and `publicUrl`/the derived storage key are persisted
    // (into an upload-ref row / `EmailLayout.logoUrl`) BEFORE the bytes
    // ever arrive, so the extension has to be right now, not after
    // processing. `application/pdf` is the one non-image type still stored
    // verbatim. Anything else gets no extension (unreachable today — every
    // caller allow-lists its own content-types first).
    const extension = command.contentType.startsWith('image/')
      ? '.webp'
      : command.contentType === 'application/pdf'
        ? '.pdf'
        : '';
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

  /**
   * Used by `UploadsController.put` for NON-image uploads (PDF today) —
   * writes the raw bytes straight to the public `key`, unchanged.
   */
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
   * GOS-70 — `UploadsController.put` parks the raw bytes of an image upload
   * here; the `image-processing` worker picks them up. Written under
   * `<uploadsDir>/.staging/<key>` so the public `key` never holds the
   * unprocessed original (satisfies "nunca se guarda el archivo original
   * tal cual llegó" at the servable layer).
   */
  async writeStagingFile(key: string, bytes: Buffer): Promise<void> {
    await mkdir(join(this.uploadsDir, STAGING_DIR_NAME), { recursive: true });
    await writeFile(this.stagingPathFor(key), bytes);
  }

  /**
   * GOS-70 — the worker reads the parked original. `null` when the staging
   * file is gone (already promoted, or a duplicate/late job) — the worker
   * treats that as a no-op, so processing is idempotent under BullMQ
   * retries.
   */
  async readStagingFile(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.stagingPathFor(key));
    } catch {
      return null;
    }
  }

  /**
   * GOS-70 — the worker's final step: write the processed WebP bytes to the
   * public `key` and drop the staged original. `rename` is atomic on a
   * single filesystem (POSIX + Windows) so `GET /uploads/:key` never
   * observes a half-written file; falls back to write+unlink if `rename`
   * across a boundary ever fails.
   */
  async promoteStagingToFinal(key: string, webpBytes: Buffer): Promise<void> {
    await mkdir(this.uploadsDir, { recursive: true });
    const finalPath = this.pathFor(key);
    const tmpPath = `${finalPath}.tmp-${randomBytes(6).toString('hex')}`;
    await writeFile(tmpPath, webpBytes);
    try {
      await rename(tmpPath, finalPath);
    } catch {
      await writeFile(finalPath, webpBytes);
      await unlink(tmpPath).catch(() => undefined);
    }
    await unlink(this.stagingPathFor(key)).catch(() => undefined);
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
    this.assertValidKey(key);
    return join(this.uploadsDir, key);
  }

  private stagingPathFor(key: string): string {
    this.assertValidKey(key);
    return join(this.uploadsDir, STAGING_DIR_NAME, key);
  }

  private assertValidKey(key: string): void {
    if (!/^[a-f0-9]{32}(\.[a-z]+)?$/.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
  }

  private signToken(key: string, expiresAtMillis: number): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${key}:${expiresAtMillis}`, 'utf8')
      .digest('hex');
  }
}
